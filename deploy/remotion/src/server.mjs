// HiveGPT motion studio worker. Renders storyboard clips (src/storyboard.mjs) as background
// jobs: POST /jobs answers at once with a job id; GET /jobs/:id reports stage and progress;
// GET /jobs/:id/video streams the MP4; DELETE /jobs/:id cancels (renderMedia's cancel signal).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { cleanString, createDiagnostics } from './diagnostics.mjs';
import {
  FPS,
  HARD_MAX_DURATION_SEC,
  NARRATION_LEAD_FRAMES,
  NARRATION_TAIL_SEC,
  SCENE_MAX_SEC,
  computeTimeline,
  dimensionsFor,
  validateStoryboard,
} from './storyboard.mjs';
import { iconNodes } from './icons.mjs';
import { pickVoice, probeAudioSec, synthesizeScenes } from './tts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3200);
const TOKEN = (process.env.REMOTION_SERVICE_TOKEN || '').trim();
const intEnv = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** CPUs this container may use: cgroup v2 `cpu.max` quota, else the visible cores. */
export function availableCpus() {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0) {
      return Math.max(1, Math.floor(Number(quota) / Number(period)));
    }
  } catch {
    // no cgroup v2 limit
  }
  return Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
}

/** One job at a time by default; each job's Chromium frame threads come from the CPU budget. */
const MAX_CONCURRENT = intEnv('REMOTION_MAX_CONCURRENT', 1, 1, 4);
const CPUS = availableCpus();
/** Leave one CPU for ffmpeg and node; split the rest between concurrent jobs. */
const RENDER_CONCURRENCY = intEnv(
  'REMOTION_RENDER_CONCURRENCY',
  Math.max(1, Math.min(8, Math.floor((CPUS - 1) / MAX_CONCURRENT) || 1)),
  1,
  16,
);
/** Default render budget per job (the api sends its own `timeoutMs`, capped by the max). */
const JOB_TIMEOUT_MS = intEnv('REMOTION_JOB_TIMEOUT_MS', 600_000, 30_000, 3_600_000);
const JOB_TIMEOUT_MAX_MS = intEnv('REMOTION_JOB_TIMEOUT_MAX_MS', 1_800_000, 60_000, 3_600_000);
const MAX_DURATION_SEC = intEnv('REMOTION_MAX_DURATION_SEC', HARD_MAX_DURATION_SEC, 5, HARD_MAX_DURATION_SEC);
const CRF = intEnv('REMOTION_CRF', 23, 18, 35);
const MAX_QUEUE = intEnv('REMOTION_MAX_QUEUE', 10, 1, 40);
/** Finished jobs (and their MP4) are kept this long for the api to fetch, then deleted. */
const RESULT_TTL_MS = intEnv('REMOTION_RESULT_TTL_MS', 30 * 60_000, 60_000, 6 * 3_600_000);
const BODY_LIMIT = intEnv('REMOTION_BODY_LIMIT_MB', 80, 5, 200) * 1024 * 1024;
/** Longest a preview (POST /stills) may take; the api's own `timeoutMs` is capped by this. */
const STILLS_TIMEOUT_MS = intEnv('REMOTION_STILLS_TIMEOUT_MS', 150_000, 5_000, 600_000);
/** Work dirs of this worker's jobs under the OS temp dir (removed at startup after a crash). */
const WORK_DIR_PREFIX = 'hivegpt-clip-';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{6,80}$/;
const ENTRY = path.join(__dirname, 'index.ts');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const COMPOSITION = 'HiveGPTStudio';
/** Icons the scenes use themselves (markers, arrows, the fallback). */
const BUILTIN_ICONS = ['sparkles', 'check', 'arrow-left', 'arrow-right', 'point', 'map-pin'];

const BUNDLE_RETRY_DELAYS_MS = [5000, 15000];

/**
 * Bundle state machine: idle | building | ready | failed. Concurrent callers share one
 * in-flight build; a failed build is never cached, the next call retries.
 */
export function createBundleManager({ bundleImpl, diag, entry = ENTRY }) {
  const state = { state: 'idle', attempts: 0, startedAt: null, readyMs: null, error: null };
  let location = null;
  let inflight = null;

  const build = () => {
    state.state = 'building';
    state.attempts += 1;
    state.startedAt = Date.now();
    diag.info('bundle.start', { attempt: state.attempts });
    inflight = (async () => {
      try {
        const result = await bundleImpl({
          entryPoint: entry,
          publicDir: PUBLIC_DIR,
          webpackOverride: (config) => config,
        });
        location = result;
        state.state = 'ready';
        state.readyMs = Date.now() - state.startedAt;
        state.error = null;
        diag.info('bundle.ready', { ms: state.readyMs, attempt: state.attempts });
        return result;
      } catch (error) {
        state.state = 'failed';
        state.error = { message: cleanString(error?.message ?? error), at: new Date().toISOString() };
        diag.error('bundle.fail', {
          ms: Date.now() - state.startedAt,
          attempt: state.attempts,
          message: error?.message ?? String(error),
          stack: String(error?.stack ?? '').split('\n').slice(0, 6).join(' | '),
        });
        throw error;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const get = () => {
    if (state.state === 'ready' && location) {
      return Promise.resolve(location);
    }
    return inflight ?? build();
  };

  /** Build in the background (startup). Retries with backoff; never throws. */
  const warm = async (delays = BUNDLE_RETRY_DELAYS_MS) => {
    for (let i = 0; i <= delays.length; i += 1) {
      try {
        await get();
        return true;
      } catch {
        if (i < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
        }
      }
    }
    return false;
  };

  return { get, warm, snapshot: () => ({ ...state }), isReady: () => state.state === 'ready' };
}

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
};

const sameToken = (header, token) => {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match || !token || token.length < 32) {
    return false;
  }
  const given = crypto.createHash('sha256').update(match[1]).digest();
  const expected = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(given, expected);
};

/**
 * The JSON body. Past `limit` the rest is read and dropped, so the caller gets a 413 answer
 * rather than a reset connection (which the api would take for a network blip and retry).
 */
const readBody = (req, limit = BODY_LIMIT) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) {
        return reject(Object.assign(new Error('The request body is too large'), { code: 'too_large', status: 413 }));
      }
      if (chunks.length === 0) {
        return resolve({});
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      } catch {
        reject(Object.assign(new Error('The request body is not JSON'), { code: 'invalid_json', status: 400 }));
      }
    });
    req.on('error', reject);
  });

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const AUDIO_EXT = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
const MEDIA_TYPES = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Check the job's asset map shape; returns { kinds } for validation or an error string. */
function inspectAssets(raw) {
  if (raw == null) {
    return { kinds: {} };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'assets: must be an object';
  }
  const kinds = {};
  for (const [id, asset] of Object.entries(raw)) {
    if (!ASSET_ID.test(id) || !asset || typeof asset !== 'object') {
      return `assets.${id.slice(0, 40)}: invalid`;
    }
    const table = asset.kind === 'image' ? IMAGE_EXT : asset.kind === 'audio' ? AUDIO_EXT : null;
    if (!table || !table[asset.mime]) {
      return `assets.${id}: kind must be image or audio with a supported mime type`;
    }
    if (typeof asset.base64 !== 'string' || asset.base64.length < 16) {
      return `assets.${id}.base64: missing`;
    }
    kinds[id] = { kind: asset.kind };
  }
  return { kinds };
}

/** Run a short command and capture the first output line. Never throws. */
const runCheck = (command, args, timeoutMs = 5000, env = process.env) =>
  new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch (error) {
      return done({ found: false, error: cleanString(error?.message ?? error) });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ found: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ found: false, error: cleanString(error?.code ?? error?.message ?? error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const first = out.trim().split('\n')[0] ?? '';
      done(code === 0 ? { found: true, version: cleanString(first) } : { found: false, error: cleanString(first || `exit ${code}`) });
    });
  });

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
};

const toMb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/** cgroup memory (v2 then v1) in MB, or nulls when unreadable. */
export const readCgroupMemory = () => {
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  let max = readText('/sys/fs/cgroup/memory.max');
  let current = readText('/sys/fs/cgroup/memory.current');
  if (max == null && current == null) {
    max = readText('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    current = readText('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  }
  const maxN = max === 'max' ? null : num(max);
  const curN = num(current);
  return {
    limitMb: maxN != null && maxN < 2 ** 50 ? toMb(maxN) : null,
    currentMb: curN != null ? toMb(curN) : null,
  };
};

const memorySnapshot = () => {
  const usage = process.memoryUsage();
  return {
    rssMb: toMb(usage.rss),
    heapUsedMb: toMb(usage.heapUsed),
    osFreeMb: toMb(os.freemem()),
    osTotalMb: toMb(os.totalmem()),
    cgroup: readCgroupMemory(),
  };
};

const remotionVersion = () => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.dependencies?.remotion ?? null;
  } catch {
    return null;
  }
};

const effectiveConfig = () => ({
  port: PORT,
  maxConcurrent: MAX_CONCURRENT,
  maxQueue: MAX_QUEUE,
  cpus: CPUS,
  renderConcurrency: RENDER_CONCURRENCY,
  jobTimeoutMs: JOB_TIMEOUT_MS,
  jobTimeoutMaxMs: JOB_TIMEOUT_MAX_MS,
  maxDurationSec: MAX_DURATION_SEC,
  resultTtlMs: RESULT_TTL_MS,
  stillsTimeoutMs: STILLS_TIMEOUT_MS,
  bodyLimitMb: Math.round(BODY_LIMIT / 1024 / 1024),
  crf: CRF,
  gl: process.env.REMOTION_GL || 'angle',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || 'remotion-managed',
  node: process.version,
  remotion: remotionVersion(),
});

const makeError = (code, message, status) => Object.assign(new Error(message), { code, ...(status ? { status } : {}) });

const stackHead = (error) => String(error?.stack ?? '').split('\n').slice(0, 6).join(' | ');

/** Validation shared by /jobs and /stills: storyboard, assets, size and audio. */
function prepareInput(body) {
  const inspected = inspectAssets(body.assets);
  if (typeof inspected === 'string') {
    throw makeError('invalid_input', inspected, 400);
  }
  const maxDurationSec = Math.min(MAX_DURATION_SEC, Number(body.maxDurationSec) || MAX_DURATION_SEC);
  const result = validateStoryboard(body.storyboard, { assets: inspected.kinds, maxDurationSec });
  if (!result.ok) {
    throw Object.assign(makeError('invalid_storyboard', result.errors.join('; '), 400), { errors: result.errors });
  }
  const audioRaw = body.audio && typeof body.audio === 'object' ? body.audio : { mode: 'none' };
  const mode = ['none', 'tts', 'upload'].includes(audioRaw.mode) ? audioRaw.mode : 'none';
  if (mode === 'upload' && inspected.kinds[audioRaw.asset]?.kind !== 'audio') {
    throw makeError('invalid_input', 'audio.asset: must name an audio asset', 400);
  }
  const shortSide = Math.min(1080, Math.max(360, Number(body.shortSide) || 720));
  const size = dimensionsFor(result.storyboard.aspectRatio, shortSide);
  return {
    storyboard: result.storyboard,
    iconNames: result.icons,
    warnings: [...result.warnings],
    audio: { mode, voice: audioRaw.voice, asset: audioRaw.asset },
    size,
    maxDurationSec,
  };
}

/** Write the job's assets to its work dir and register them on the /media route. */
async function writeAssets(ctx, job, assets) {
  const refs = {};
  for (const [id, asset] of Object.entries(assets ?? {})) {
    const table = asset.kind === 'image' ? IMAGE_EXT : AUDIO_EXT;
    const name = `${id}.${table[asset.mime]}`;
    const file = path.join(job.workDir, name);
    await fs.writeFile(file, Buffer.from(asset.base64, 'base64'));
    const mediaId = crypto.randomUUID();
    ctx.media.set(mediaId, { file, name });
    job.mediaIds.push(mediaId);
    refs[id] = {
      src: `http://127.0.0.1:${ctx.getPort()}/media/${mediaId}/${name}`,
      file,
      ...(typeof asset.credit === 'string' && asset.credit ? { credit: asset.credit.slice(0, 80) } : {}),
    };
  }
  return refs;
}

function registerFile(ctx, job, file) {
  const mediaId = crypto.randomUUID();
  const name = path.basename(file);
  ctx.media.set(mediaId, { file, name });
  job.mediaIds.push(mediaId);
  return `http://127.0.0.1:${ctx.getPort()}/media/${mediaId}/${name}`;
}

/** Narration, captions and final scene lengths. Narration lengthens a scene; never shortens it. */
async function buildAudio(ctx, job, prepared, assetRefs) {
  const { storyboard } = prepared;
  const scenes = storyboard.scenes.map((scene) => ({ ...scene }));
  const narration = [];
  const words = [];
  let uploadAudio;
  if (prepared.audio.mode === 'tts' && scenes.some((scene) => scene.narration)) {
    job.setStage('tts', 0.03);
    const voice = pickVoice(prepared.audio.voice, storyboard.lang);
    const started = Date.now();
    const lines = await ctx.ttsImpl(scenes, voice, job.workDir, { signal: job.abort.signal });
    job.timings.ttsMs = Date.now() - started;
    for (const line of lines) {
      const sec = (await ctx.probeImpl(line.file)) ?? (line.words.at(-1)?.endMs ?? 0) / 1000 + 0.3;
      const need = sec + NARRATION_LEAD_FRAMES / FPS + NARRATION_TAIL_SEC;
      const scene = scenes[line.index];
      if (need > scene.durationSec) {
        scene.durationSec = Math.min(SCENE_MAX_SEC * 1.5, Math.round(need * 10) / 10);
      }
      line.sec = sec;
    }
    const timeline = computeTimeline(scenes);
    for (const line of lines) {
      const from = timeline.scenes[line.index].from + NARRATION_LEAD_FRAMES;
      narration.push({ src: registerFile(ctx, job, line.file), from, frames: Math.ceil(line.sec * FPS) + 2 });
      for (const word of line.words) {
        words.push({
          text: String(word.text),
          start: from + Math.round((word.startMs / 1000) * FPS),
          end: from + Math.round((word.endMs / 1000) * FPS),
        });
      }
    }
    ctx.diag.info('tts.ok', { ms: job.timings.ttsMs, lines: lines.length, words: words.length, voice }, job.id);
  } else if (prepared.audio.mode === 'upload') {
    const ref = assetRefs[prepared.audio.asset];
    uploadAudio = ref.src;
    const sec = await ctx.probeImpl(ref.file);
    const total = scenes.reduce((s, scene) => s + scene.durationSec, 0);
    if (sec && sec > total) {
      const last = scenes[scenes.length - 1];
      const extra = Math.min(sec - total, prepared.maxDurationSec - total);
      if (extra > 0) {
        last.durationSec = Math.round((last.durationSec + extra) * 10) / 10;
      }
      if (sec - total > extra + 0.5) {
        job.warnings.push(`audio_trimmed: the uploaded audio is ${Math.round(sec)}s; the clip stops at ${prepared.maxDurationSec}s`);
      }
    }
  }
  const total = scenes.reduce((s, scene) => s + scene.durationSec, 0);
  if (total > prepared.maxDurationSec + 0.05) {
    throw makeError(
      'narration_too_long',
      `The narration needs ${Math.round(total)}s but the limit is ${prepared.maxDurationSec}s; shorten the narration`,
      422,
    );
  }
  return { scenes, narration, words, uploadAudio };
}

function buildProps(prepared, built, assetRefs) {
  const nodes = iconNodes();
  const icons = {};
  for (const name of new Set([...prepared.iconNames, ...BUILTIN_ICONS])) {
    if (nodes[name]) {
      icons[name] = nodes[name];
    }
  }
  const assets = {};
  for (const [id, ref] of Object.entries(assetRefs)) {
    assets[id] = { src: ref.src, ...(ref.credit ? { credit: ref.credit } : {}) };
  }
  const storyboard = { ...prepared.storyboard, scenes: built.scenes };
  return {
    storyboard,
    timeline: computeTimeline(built.scenes),
    icons,
    assets,
    narration: built.narration,
    words: built.words,
    ...(built.uploadAudio ? { uploadAudio: built.uploadAudio } : {}),
    size: prepared.size,
  };
}

/** Browser console: quality signals by tag only; other text is counted, never logged. */
function browserLogHandler(ctx, job) {
  let logged = 0;
  return (entry) => {
    const text = String(entry?.text ?? '');
    const overflow = /^\[hivegpt:overflow\] ([A-Za-z0-9_.[\]-]{1,80})$/.exec(text);
    if (overflow) {
      const warning = `text_overflow: ${overflow[1]}`;
      if (!job.warnings.includes(warning)) {
        job.warnings.push(warning);
      }
      return;
    }
    if (logged >= 20 || (entry?.type !== 'error' && entry?.type !== 'warning')) {
      return;
    }
    logged += 1;
    ctx.diag.warn('browser.log', { type: entry.type, chars: text.length }, job.id);
  };
}

/**
 * One render job, start to finish, from its validated input (`job.input`) and the assets
 * written to its work dir at accept time (`job.assetRefs`). Throws coded errors; the caller
 * records the outcome.
 */
async function runJob(ctx, job) {
  job.setStage('validate', 0.01);
  const prepared = job.input;
  job.warnings.push(...prepared.warnings);
  Object.assign(job.summary, {
    scenes: prepared.storyboard.scenes.length,
    theme: prepared.storyboard.theme,
    aspect: prepared.storyboard.aspectRatio,
    audio: prepared.audio.mode,
  });
  ctx.diag.info('job.start', { ...job.summary, ...prepared.size }, job.id);

  job.setStage('assets', 0.02);
  const assetRefs = job.assetRefs;
  let built;
  try {
    built = await buildAudio(ctx, job, prepared, assetRefs);
  } catch (error) {
    if (error?.code === 'narration_too_long' || job.cancelled || job.abort.signal.aborted) {
      throw error;
    }
    job.warnings.push(`tts_failed: ${cleanString(error?.message ?? error).slice(0, 120)}`);
    ctx.diag.warn('tts.fail', { message: error?.message ?? String(error) }, job.id);
    built = { scenes: prepared.storyboard.scenes, narration: [], words: [] };
  }
  const inputProps = buildProps(prepared, built, assetRefs);
  const frames = inputProps.timeline.totalFrames;
  Object.assign(job.summary, { frames, ...prepared.size });
  job.result.durationSec = frames / FPS;
  /** Final scene starts and lengths (after narration stretched them), for frame checks. */
  job.result.scenes = inputProps.timeline.scenes.map(({ from, frames: length, transitionOut }) => ({ from, frames: length, transitionOut }));
  job.result.width = prepared.size.width;
  job.result.height = prepared.size.height;

  job.setStage('bundle', 0.13);
  const bundleStart = Date.now();
  const serveUrl = await ctx.bundles.get();
  job.timings.bundleMs = Date.now() - bundleStart;

  job.setStage('select', 0.15);
  const selectStart = Date.now();
  const composition = await ctx.selectImpl({ serveUrl, id: COMPOSITION, inputProps, ...ctx.browserOptions });
  job.timings.selectMs = Date.now() - selectStart;

  job.setStage('render', 0.16);
  const outputPath = path.join(job.workDir, 'out.mp4');
  const renderStart = Date.now();
  let nextMark = 25;
  await ctx.renderImpl({
    composition: { ...composition, ...prepared.size, fps: FPS, durationInFrames: frames },
    serveUrl,
    codec: 'h264',
    imageFormat: 'jpeg',
    jpegQuality: 88,
    crf: CRF,
    audioCodec: 'aac',
    outputLocation: outputPath,
    inputProps,
    concurrency: ctx.renderConcurrency,
    cancelSignal: job.cancelSignal,
    ...ctx.browserOptions,
    chromiumOptions: { disableWebSecurity: false, gl: process.env.REMOTION_GL || 'angle' },
    timeoutInMilliseconds: 60_000,
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
      const p = Math.max(0, Math.min(1, progress ?? 0));
      job.setStage(stitchStage === 'muxing' ? 'encode' : 'render', 0.16 + 0.82 * p);
      job.frames = { rendered: renderedFrames, encoded: encodedFrames, total: frames };
      const pct = Math.floor(p * 100);
      while (pct >= nextMark && nextMark <= 100) {
        ctx.diag.info('render.progress', { pct: nextMark, renderedFrames, encodedFrames, ms: Date.now() - renderStart }, job.id);
        nextMark += 25;
      }
    },
    onBrowserLog: browserLogHandler(ctx, job),
  });
  job.timings.renderMs = Date.now() - renderStart;
  const stat = await fs.stat(outputPath);
  job.result.file = outputPath;
  job.result.bytes = stat.size;
}

/** FIFO queue of job records: at most `maxConcurrent` run; overflow is rejected (busy). */
export function createQueue(maxConcurrent, maxQueue) {
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < maxConcurrent && waiting.length > 0) {
      const next = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(() => next.run())
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  const full = () => active >= maxConcurrent && waiting.length >= maxQueue;
  return {
    stats: () => ({ active, waiting: waiting.length, maxConcurrent, maxQueue }),
    full,
    position: (id) => waiting.findIndex((item) => item.id === id),
    remove(id) {
      const at = waiting.findIndex((item) => item.id === id);
      if (at >= 0) {
        waiting.splice(at, 1);
        return true;
      }
      return false;
    },
    enqueue(id, run) {
      if (full()) {
        throw makeError('busy', `The render queue is full (${maxConcurrent} running, ${maxQueue} waiting).`, 429);
      }
      waiting.push({ id, run });
      pump();
    },
  };
}

/** GET /media/<uuid>/<name>: only files registered for a running job, looked up by id. */
const serveMedia = (ctx, url, res) => {
  const [, , id, name] = url.pathname.split('/');
  const entry = id ? ctx.media.get(id) : undefined;
  if (!entry || !name || name !== entry.name) {
    return send(res, 404, { error: 'not_found', message: 'Not found' });
  }
  const type = MEDIA_TYPES[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream';
  return fs
    .stat(entry.file)
    .then((stat) => {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      const stream = createReadStream(entry.file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    })
    .catch(() => send(res, 404, { error: 'not_found', message: 'Not found' }));
};

/** What GET /jobs/:id answers (never the storyboard or assets). */
function jobView(job, queue) {
  const position = job.state === 'queued' ? queue.position(job.id) : -1;
  return {
    ok: true,
    jobId: job.id,
    state: job.state,
    stage: job.stage,
    progress: Math.round(job.progress * 1000) / 1000,
    ...(position >= 0 ? { position: position + 1 } : {}),
    createdAt: new Date(job.createdAt).toISOString(),
    ...(job.startedAt ? { startedAt: new Date(job.startedAt).toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: new Date(job.finishedAt).toISOString() } : {}),
    timeoutMs: job.timeoutMs,
    timings: job.timings,
    ...(job.frames ? { frames: job.frames } : {}),
    ...(job.result.durationSec ? { durationSec: job.result.durationSec, width: job.result.width, height: job.result.height } : {}),
    ...(job.result.bytes ? { bytes: job.result.bytes } : {}),
    ...(job.result.scenes ? { scenes: job.result.scenes } : {}),
    warnings: job.warnings,
    ...(job.error ? { error: job.error.code, message: job.error.message, ...(job.error.errors ? { errors: job.error.errors } : {}) } : {}),
  };
}

/**
 * `bundleImpl`, `selectImpl`, `renderImpl`, `stillImpl`, `ttsImpl` and `probeImpl` are
 * injectable so tests run without Chromium. `server.media` lets tests register /media files.
 */
export function createServer({
  token = TOKEN,
  diagnostics = createDiagnostics(),
  bundleImpl = bundle,
  selectImpl = selectComposition,
  renderImpl = renderMedia,
  stillImpl = renderStill,
  ttsImpl = synthesizeScenes,
  probeImpl = probeAudioSec,
  jobTimeoutMs = JOB_TIMEOUT_MS,
  jobGraceMs = 5000,
  resultTtlMs = RESULT_TTL_MS,
  maxConcurrent = MAX_CONCURRENT,
  maxQueue = MAX_QUEUE,
  renderConcurrency = RENDER_CONCURRENCY,
  stillsTimeoutMs = STILLS_TIMEOUT_MS,
  bodyLimit = BODY_LIMIT,
  browserOptions = process.env.REMOTION_BROWSER_EXECUTABLE ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE } : {},
} = {}) {
  const diag = diagnostics;
  const queue = createQueue(maxConcurrent, maxQueue);
  const bundles = createBundleManager({ bundleImpl, diag });
  const jobs = new Map();
  /** Idempotency key (the api's MediaJob id) -> worker job id, for as long as the job is kept. */
  const keys = new Map();
  const startedAt = Date.now();
  let stillBusy = false;
  const ctx = {
    diag,
    bundles,
    media: new Map(),
    selectImpl,
    renderImpl,
    ttsImpl,
    probeImpl,
    browserOptions,
    renderConcurrency,
    getPort: () => server.address()?.port ?? PORT,
  };

  const cleanup = async (job) => {
    for (const id of job.mediaIds) {
      ctx.media.delete(id);
    }
    job.mediaIds = [];
  };
  const forget = (job) => {
    jobs.delete(job.id);
    if (job.idempotencyKey && keys.get(job.idempotencyKey) === job.id) {
      keys.delete(job.idempotencyKey);
    }
    fs.rm(job.workDir, { recursive: true, force: true }).catch(() => undefined);
  };
  const finish = (job, state, error) => {
    if (job.finishedAt) {
      return;
    }
    job.state = state;
    job.finishedAt = Date.now();
    if (state === 'done') {
      job.progress = 1;
      job.stage = 'done';
    }
    if (error) {
      job.error = error;
    }
    clearTimeout(job.timer);
    clearTimeout(job.deadline);
    cleanup(job);
    const totalMs = job.finishedAt - (job.startedAt ?? job.createdAt);
    diag.recordJob({
      jobId: job.id,
      ...job.summary,
      stage: job.stage,
      ok: state === 'done',
      state,
      ...(error ? { error: error.code, message: error.message } : {}),
      ...job.timings,
      totalMs,
      bytes: job.result.bytes,
      peakRssMb: toMb(job.peakRss),
      warnings: job.warnings.length ? job.warnings : undefined,
    });
    if (state === 'done') {
      diag.info('render.ok', { ms: job.timings.renderMs, bytes: job.result.bytes, totalMs }, job.id);
    } else {
      diag[state === 'cancelled' ? 'info' : 'error']('job.fail', { state, stage: job.stage, code: error?.code, message: error?.message }, job.id);
    }
    const ttl = setTimeout(() => forget(job), resultTtlMs);
    ttl.unref?.();
  };

  const createJob = async (body) => {
    const id = crypto.randomUUID().slice(0, 12);
    const { cancelSignal, cancel } = makeCancelSignal();
    const requested = Number(body.timeoutMs);
    const job = {
      id,
      state: 'queued',
      stage: 'queued',
      progress: 0,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      timeoutMs: Number.isFinite(requested) && requested > 0 ? Math.min(JOB_TIMEOUT_MAX_MS, Math.max(30_000, requested)) : jobTimeoutMs,
      timings: { ttsMs: 0, bundleMs: 0, selectMs: 0, renderMs: 0 },
      warnings: [],
      summary: {},
      result: {},
      mediaIds: [],
      peakRss: 0,
      cancelled: false,
      cancelSignal,
      cancel,
      abort: new AbortController(),
      workDir: await fs.mkdtemp(path.join(os.tmpdir(), WORK_DIR_PREFIX)),
      setStage(stage, progress) {
        job.stage = stage;
        if (progress != null) {
          job.progress = Math.max(job.progress, progress);
        }
      },
    };
    return job;
  };

  const start = (job) => async () => {
    if (job.cancelled) {
      return;
    }
    job.state = 'running';
    job.startedAt = Date.now();
    const sampler = setInterval(() => {
      job.peakRss = Math.max(job.peakRss, process.memoryUsage().rss);
    }, 500);
    sampler.unref?.();
    let timedOut = false;
    /** Cooperative stop for renderMedia and TTS... */
    job.timer = setTimeout(() => {
      timedOut = true;
      job.cancel();
      job.abort.abort();
    }, job.timeoutMs);
    /** ...and a hard deadline for a hang in any other stage, so the slot is always freed. */
    const deadline = new Promise((_, reject) => {
      job.deadline = setTimeout(() => {
        reject(makeError('timeout', `Job exceeded ${job.timeoutMs}ms at stage ${job.stage}`));
      }, job.timeoutMs + jobGraceMs);
      job.deadline.unref?.();
    });
    const work = runJob(ctx, job);
    work.catch(() => undefined);
    try {
      await Promise.race([work, deadline]);
      finish(job, 'done');
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      if (job.cancelled) {
        finish(job, 'cancelled', { code: 'cancelled', message: 'The job was cancelled' });
      } else if (timedOut || error.code === 'timeout') {
        finish(job, 'failed', { code: 'timeout', message: `Job exceeded ${job.timeoutMs}ms at stage ${job.stage}` });
      } else {
        finish(job, 'failed', {
          code: error.code || 'render_failed',
          message: cleanString(String(error.message).split('\n')[0]).slice(0, 300),
          ...(error.errors ? { errors: error.errors } : {}),
        });
        if (!error.code) {
          diag.error('job.exception', { stage: job.stage, stack: stackHead(error) }, job.id);
        }
      }
    } finally {
      clearInterval(sampler);
      clearTimeout(job.timer);
      clearTimeout(job.deadline);
    }
  };

  const cancelJob = (job) => {
    if (job.finishedAt) {
      return false;
    }
    job.cancelled = true;
    if (queue.remove(job.id)) {
      finish(job, 'cancelled', { code: 'cancelled', message: 'The job was cancelled' });
      return true;
    }
    job.cancel();
    job.abort.abort();
    return true;
  };

  /**
   * Key frames as small JPEGs: 60% into each scene, the first `stills` scenes (default 6). The
   * work races a deadline (the api's `timeoutMs`, capped by `stillsTimeoutMs`); at the deadline
   * the render is cancelled and the preview slot is free again, whatever Chromium does.
   */
  const renderStills = async (body) => {
    if (stillBusy) {
      throw makeError('busy', 'A preview is already rendering; try again in a moment.', 429);
    }
    stillBusy = true;
    const requested = Number(body.timeoutMs);
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(stillsTimeoutMs, requested) : stillsTimeoutMs;
    const { cancelSignal, cancel } = makeCancelSignal();
    let timedOut = false;
    let timer;
    let job;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        cancel();
        reject(makeError('timeout', `The preview exceeded ${timeoutMs}ms`, 504));
      }, timeoutMs);
    });
    const work = (async () => {
      job = await createJob({});
      const prepared = prepareInput(body);
      const assetRefs = await writeAssets(ctx, job, body.assets);
      const inputProps = buildProps(prepared, { scenes: prepared.storyboard.scenes, narration: [], words: [] }, assetRefs);
      const serveUrl = await bundles.get();
      const composition = await selectImpl({ serveUrl, id: COMPOSITION, inputProps, timeoutInMilliseconds: timeoutMs, ...browserOptions });
      const count = Math.min(30, Math.max(1, Math.round(Number(body.stills) || 6)));
      const last = inputProps.timeline.totalFrames - 1;
      /** `frames`: exact frames to render (transition checks); else 60% into each scene. */
      const frames = Array.isArray(body.frames)
        ? body.frames.filter((f) => Number.isInteger(f) && f >= 0 && f <= last).slice(0, 30)
        : inputProps.timeline.scenes.slice(0, count).map((entry) => Math.min(last, entry.from + Math.round(entry.frames * 0.6)));
      const stills = [];
      for (const frame of frames) {
        if (timedOut) {
          break;
        }
        const { buffer } = await stillImpl({
          composition: { ...composition, ...prepared.size, fps: FPS, durationInFrames: inputProps.timeline.totalFrames },
          serveUrl,
          frame,
          inputProps,
          imageFormat: body.format === 'png' ? 'png' : 'jpeg',
          ...(body.format === 'png' ? {} : { jpegQuality: 78 }),
          scale: body.scale === 1 ? 1 : 0.5,
          cancelSignal,
          timeoutInMilliseconds: timeoutMs,
          ...browserOptions,
          onBrowserLog: browserLogHandler(ctx, job),
        });
        stills.push({ frame, mime: body.format === 'png' ? 'image/png' : 'image/jpeg', base64: Buffer.from(buffer).toString('base64') });
      }
      return { ok: true, stills, warnings: [...prepared.warnings, ...job.warnings] };
    })();
    work.catch(() => undefined);
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      stillBusy = false;
      if (timedOut) {
        diag.warn('stills.timeout', { timeoutMs });
      }
      if (job) {
        await cleanup(job);
        forget(job);
      } else {
        /** Timed out before its work dir existed: remove it once it does. */
        work.finally(() => job && (cleanup(job), forget(job))).catch(() => undefined);
      }
    }
  };

  const health = () => ({
    ok: true,
    ...queue.stats(),
    jobs: jobs.size,
    ready: bundles.isReady(),
    bundle: bundles.snapshot().state,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://remotion');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, health());
      }
      if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
        return await serveMedia(ctx, url, res);
      }
      if (!sameToken(req.headers.authorization, token)) {
        return send(res, 401, { error: 'unauthorized', message: 'Unauthorized' });
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(res, 200, {
          ...health(),
          bundleDetail: bundles.snapshot(),
          checks: server.checks ?? null,
          config: { ...effectiveConfig(), maxConcurrent, maxQueue, renderConcurrency },
          memory: memorySnapshot(),
          counters: diag.counters(),
          activeJobs: [...jobs.values()].filter((job) => !job.finishedAt).map((job) => jobView(job, queue)),
          lastJobs: diag.lastJobs(),
          lastLogId: diag.lastId(),
        });
      }
      if (req.method === 'GET' && url.pathname === '/logs') {
        const entries = diag.getLogs({
          limit: url.searchParams.get('limit') ?? 200,
          minLevel: url.searchParams.get('level') ?? 'debug',
          afterId: url.searchParams.get('after') ?? 0,
        });
        return send(res, 200, { ok: true, entries, lastId: diag.lastId() });
      }
      if (req.method === 'POST' && url.pathname === '/jobs') {
        const header = req.headers['idempotency-key'];
        const key = typeof header === 'string' && IDEMPOTENCY_KEY.test(header) ? header : null;
        const known = key ? jobs.get(keys.get(key)) : undefined;
        if (known) {
          /** A resubmit (the api lost our answer): the same job, and the body is not kept. */
          req.resume();
          await new Promise((resolve) => req.on('end', resolve).on('error', resolve));
          diag.info('job.resubmitted', { state: known.state }, known.id);
          return send(res, 200, jobView(known, queue));
        }
        const body = await readBody(req, bodyLimit);
        const input = prepareInput(body);
        if (queue.full()) {
          throw makeError('busy', `The render queue is full (${maxConcurrent} running, ${maxQueue} waiting).`, 429);
        }
        const job = await createJob(body);
        try {
          /** The assets go to the work dir now; a queued job holds paths, never base64. */
          job.assetRefs = await writeAssets(ctx, job, body.assets);
          job.input = input;
          job.idempotencyKey = key ?? undefined;
          queue.enqueue(job.id, start(job));
        } catch (error) {
          await cleanup(job);
          forget(job);
          throw error;
        }
        jobs.set(job.id, job);
        if (key) {
          keys.set(key, job.id);
        }
        diag.info('job.queued', { position: queue.position(job.id) + 1, timeoutMs: job.timeoutMs }, job.id);
        return send(res, 202, jobView(job, queue));
      }
      if (req.method === 'POST' && url.pathname === '/stills') {
        const body = await readBody(req, bodyLimit);
        return send(res, 200, await renderStills(body));
      }
      const match = /^\/jobs\/([a-f0-9-]{6,40})(\/video)?$/.exec(url.pathname);
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) {
          return send(res, 404, { error: 'not_found', message: 'Unknown or expired job' });
        }
        if (req.method === 'GET' && !match[2]) {
          return send(res, 200, jobView(job, queue));
        }
        if (req.method === 'DELETE' && !match[2]) {
          const cancelled = cancelJob(job);
          diag.info('job.cancel', { cancelled, state: job.state }, job.id);
          return send(res, 200, { ...jobView(job, queue), cancelled });
        }
        if (req.method === 'GET' && match[2]) {
          if (job.state !== 'done' || !job.result.file) {
            return send(res, 409, { error: 'not_ready', message: `The job is ${job.state}` });
          }
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': job.result.bytes, 'Cache-Control': 'no-store' });
          const stream = createReadStream(job.result.file);
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          stream.pipe(res);
          return undefined;
        }
      }
      return send(res, 404, { error: 'not_found', message: 'Not found' });
    } catch (error) {
      const code = error?.code || 'render_failed';
      const status = error?.status || (code === 'busy' ? 429 : 500);
      diag.warn('request.fail', { code, status, message: error?.message ?? String(error) });
      return send(res, status, {
        ok: false,
        error: code,
        message: cleanString(String(error?.message || 'Request failed')).slice(0, 600),
        ...(error?.errors ? { errors: error.errors } : {}),
      });
    }
  });
  server.diagnostics = diag;
  server.bundles = bundles;
  server.media = ctx.media;
  server.jobs = jobs;
  return server;
}

/**
 * Removes the work dirs a crashed worker left in `dir` (the container's /tmp). Run at startup
 * only, before any job of this process exists. Returns how many were removed.
 */
export async function sweepTempDirs(dir = os.tmpdir()) {
  let removed = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(WORK_DIR_PREFIX)) {
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true }).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

/** Startup self-check of the external binaries the worker shells out to. */
export async function runSelfCheck(diag) {
  const chromium = process.env.REMOTION_BROWSER_EXECUTABLE;
  const python = process.env.REMOTION_TTS_PYTHON || 'python3';
  const [chrome, ffprobe, edgeTts] = await Promise.all([
    chromium ? runCheck(chromium, ['--version']) : Promise.resolve({ found: true, version: 'remotion-managed browser' }),
    runCheck('ffprobe', ['-version']),
    runCheck(python, ['-c', 'import edge_tts; print("edge-tts", edge_tts.__version__)']),
  ]);
  const checks = { chromium: chrome, ffprobe, edgeTts };
  for (const [name, result] of Object.entries(checks)) {
    diag.log(result.found ? 'info' : 'warn', 'selfcheck', { name, ...result });
  }
  return checks;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!TOKEN || TOKEN.length < 32) {
    console.error('[remotion] REMOTION_SERVICE_TOKEN must be at least 32 characters');
    process.exit(1);
  }
  const server = createServer();
  const diag = server.diagnostics;
  process.on('unhandledRejection', (reason) => {
    diag.error('process.unhandledRejection', { message: reason?.message ?? String(reason), stack: stackHead(reason) });
  });
  process.on('uncaughtException', (error) => {
    diag.error('process.uncaughtException', { message: error?.message ?? String(error), stack: stackHead(error) });
    process.exit(1);
  });
  const swept = await sweepTempDirs();
  if (swept > 0) {
    diag.warn('startup.swept_temp_dirs', { count: swept });
  }
  server.listen(PORT, () => {
    diag.info('server.listening', effectiveConfig());
    diag.info('server.memory', memorySnapshot());
    runSelfCheck(diag)
      .then((checks) => {
        server.checks = checks;
      })
      .catch((error) => diag.warn('selfcheck.fail', { message: error?.message ?? String(error) }));
    server.bundles.warm().then((ok) => {
      if (!ok) {
        diag.error('bundle.warm_gave_up', { note: 'next render request retries the bundle' });
      }
    });
  });
}
