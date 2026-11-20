import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import { cleanString, createDiagnostics } from './diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3200);
const TOKEN = (process.env.REMOTION_SERVICE_TOKEN || '').trim();
const intEnv = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
/** One render at a time by default: a 2 CPU / 4 GB container cannot hold two Chromium renders. */
const MAX_CONCURRENT = intEnv('REMOTION_MAX_CONCURRENT', 1, 1, 4);
/** Chromium frame threads per render (os.cpus() inside a container reports host cores). */
const RENDER_CONCURRENCY = intEnv('REMOTION_RENDER_CONCURRENCY', 1, 1, 8);
const JOB_TIMEOUT_MS = intEnv('REMOTION_JOB_TIMEOUT_MS', 420_000, 10_000, 3_600_000);
/** Style films loop their 5s animation; this caps the output length (measured 0.06-0.28 s/frame, so 30 s of the heaviest theme is too close to the job timeout). */
const STYLE_FILM_MAX_SEC = intEnv('REMOTION_STYLE_FILM_MAX_SEC', 15, 5, 30);
/** 3D themes are a CPU software rasterizer (~1.2 s/frame at 1 thread), so they get a lower cap. */
const STYLE_FILM_3D_MAX_SEC = intEnv('REMOTION_STYLE_FILM_3D_MAX_SEC', 6, 3, 30);
const THEMES_3D = new Set(['brick-toy', 'claymation']);
/** x264 constant rate factor; higher = smaller files (noisy themes made 13 MB for 3 s at the default 18). */
const CRF = intEnv('REMOTION_CRF', 26, 18, 35);
const MIN_FRAMES = 15;
const FPS = 30;
const MAX_QUEUE = Math.min(40, Math.max(1, Number(process.env.REMOTION_MAX_QUEUE || 20)));
const MAX_DURATION_SEC = 30;
const BODY_LIMIT = 25 * 1024 * 1024;
const ENTRY = path.join(__dirname, 'index.ts');

const HEX = /^#([0-9a-fA-F]{6})$/;
const THEMES = new Set([
  'brand-dark',
  'brand-light',
  'ugc',
  'chalkboard',
  'pixel-art',
  'flat-vector',
  'woodblock-print',
  'cartoon-1930s',
  'brick-toy',
  'paper-cut',
  'maths-diagram',
  'cartoon-explainer',
  'blueprint',
  'watercolor',
  'claymation',
]);

/** Themes that use full style films (see src/themeMap.ts). Brand shells stay on HiveGPTClip. */
const STYLE_FILM_THEMES = new Set([
  'chalkboard',
  'pixel-art',
  'flat-vector',
  'woodblock-print',
  'cartoon-1930s',
  'brick-toy',
  'paper-cut',
  'maths-diagram',
  'cartoon-explainer',
  'blueprint',
  'watercolor',
  'claymation',
]);


const BUNDLE_RETRY_DELAYS_MS = [5000, 15000];

/**
 * Bundle state machine: idle | building | ready | failed. Concurrent callers share one
 * in-flight build; a failed build is never cached, the next call retries.
 */
export function createBundleManager({ bundleImpl, diag, entry = ENTRY }) {
  const state = {
    state: 'idle',
    attempts: 0,
    startedAt: null,
    readyMs: null,
    error: null,
  };
  let location = null;
  let inflight = null;

  const build = () => {
    state.state = 'building';
    state.attempts += 1;
    state.startedAt = Date.now();
    diag.info('bundle.start', { attempt: state.attempts });
    inflight = (async () => {
      try {
        const result = await bundleImpl({ entryPoint: entry, webpackOverride: (config) => config });
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

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('too_large'), { code: 'too_large', status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        return resolve({});
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      } catch {
        reject(Object.assign(new Error('invalid_json'), { code: 'invalid_json', status: 400 }));
      }
    });
    req.on('error', reject);
  });

const clampDuration = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.min(MAX_DURATION_SEC, Math.max(0.5, Math.round(n * 10) / 10));
};

const parseScenes = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) {
    return null;
  }
  const scenes = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const type = item.type;
    if (type !== 'title' && type !== 'bullets' && type !== 'closing') {
      return null;
    }
    const durationSec = clampDuration(item.durationSec ?? item.duration_sec);
    if (durationSec == null) {
      return null;
    }
    const bullets = Array.isArray(item.bullets)
      ? item.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 6)
      : undefined;
    scenes.push({
      type,
      durationSec,
      ...(item.heading ? { heading: String(item.heading).slice(0, 160) } : {}),
      ...(item.body ? { body: String(item.body).slice(0, 400) } : {}),
      ...(bullets?.length ? { bullets } : {}),
    });
  }
  return scenes;
};

/** Free Edge TTS when the request asks for narration and did not upload audio. */
const synthesizeTts = async (text, voice, workDir, { signal } = {}) => {
  const out = path.join(workDir, 'tts.mp3');
  const chosen =
    typeof voice === 'string' && voice.trim()
      ? voice.trim()
      : /[\u0600-\u06FF]/.test(text)
        ? 'fa-IR-DilaraNeural'
        : 'en-US-JennyNeural';
  await new Promise((resolve, reject) => {
    const child = spawn(
      'edge-tts',
      ['--voice', chosen, '--text', text.slice(0, 4000), '--write-media', out],
      { stdio: ['ignore', 'pipe', 'pipe'], signal },
    );
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const lastLine = err.trim().split('\n').pop();
        reject(new Error(lastLine || `edge-tts exited ${code}`));
      }
    });
  });
  return out;
};

const AUDIO_EXT = { wav: 'wav', m4a: 'm4a', mp4: 'm4a', ogg: 'ogg', webm: 'webm' };
const MEDIA_TYPES = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

const writeAudioFile = async (workDir, base64, mime) => {
  const key = Object.keys(AUDIO_EXT).find((k) => typeof mime === 'string' && mime.includes(k));
  const file = path.join(workDir, `audio.${key ? AUDIO_EXT[key] : 'mp3'}`);
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
  return file;
};

/** Run a short command and capture the first output line. Never throws. */
const runCheck = (command, args, timeoutMs = 5000) =>
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
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      done(
        code === 0
          ? { found: true, version: cleanString(first) }
          : { found: false, error: cleanString(first || `exit ${code}`) },
      );
    });
  });

/** PCM wav length from its header (fallback when ffprobe is missing). */
const wavSeconds = async (file) => {
  try {
    const buf = await fs.readFile(file);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
      return null;
    }
    const byteRate = buf.readUInt32LE(28);
    return byteRate > 0 ? (buf.length - 44) / byteRate : null;
  } catch {
    return null;
  }
};

/** Length of an audio file in seconds via ffprobe, or null. */
const probeAudioSec = async (file) => {
  const viaFfprobe = await runProbe(file);
  return viaFfprobe ?? (file.endsWith('.wav') ? wavSeconds(file) : null);
};

const runProbe = (file) =>
  new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
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
  renderConcurrency: RENDER_CONCURRENCY,
  jobTimeoutMs: JOB_TIMEOUT_MS,
  styleFilmMaxSec: STYLE_FILM_MAX_SEC,
  styleFilm3dMaxSec: STYLE_FILM_3D_MAX_SEC,
  crf: CRF,
  gl: process.env.REMOTION_GL || 'angle',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || 'remotion-managed',
  node: process.version,
  remotion: remotionVersion(),
});

const makeError = (code, message, status) =>
  Object.assign(new Error(message), { code, ...(status ? { status } : {}) });

const stackHead = (error) => String(error?.stack ?? '').split('\n').slice(0, 6).join(' | ');

/**
 * One render. `ctx` carries the per-server pieces: diag, bundles, media registry, port and the
 * injectable bundle/select/render functions.
 */
async function renderJobInner(ctx, input, queuedMs, guard) {
  const { diag } = ctx;
  const started = Date.now();
  const jobId = crypto.randomUUID().slice(0, 8);
  const timings = { bundleMs: 0, ttsMs: 0, selectMs: 0, renderMs: 0 };
  const warnings = [];
  const summary = { jobId, stage: 'init', audio: 'none', queuedMs };
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hivegpt-clip-'));
  let mediaId = null;
  let peakRss = 0;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 500);
  sampler.unref?.();
  const setStage = (name) => {
    summary.stage = name;
  };
  const timeout = { hit: false };
  const { cancelSignal, cancel } = makeCancelSignal();
  Object.assign(guard, { jobId, summary, cancel });
  const timer = setTimeout(() => {
    timeout.hit = true;
    cancel();
  }, ctx.jobTimeoutMs);

  try {
    setStage('input');
    const scenes = parseScenes(input.scenes);
    if (!scenes) {
      throw makeError('invalid_input', 'invalid_scenes', 400);
    }
    const sceneSum = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
    const requestedSec = Math.min(MAX_DURATION_SEC, clampDuration(input.durationSec) ?? sceneSum);
    const width = Math.min(1920, Math.max(360, Math.round(Number(input.width) || 405)));
    const height = Math.min(1920, Math.max(360, Math.round(Number(input.height) || 720)));
    const theme = THEMES.has(input.theme) ? input.theme : 'brand-dark';
    const brandName = String(input.brandName || 'HiveGPT').slice(0, 40);
    const brandColor =
      typeof input.brandColor === 'string' && HEX.test(input.brandColor.trim())
        ? input.brandColor.trim()
        : '#2ea884';
    const title = String(input.title || 'clip').slice(0, 120);
    const styleFilm = STYLE_FILM_THEMES.has(theme);
    const wantsUpload = typeof input.audioBase64 === 'string' && input.audioBase64.length > 0;
    const wantsTts = !wantsUpload && typeof input.ttsText === 'string' && input.ttsText.trim();
    Object.assign(summary, { theme, scenes: scenes.length, styleFilm });
    diag.info(
      'job.start',
      {
        theme,
        scenes: scenes.length,
        width,
        height,
        requestedSec,
        audio: wantsUpload ? 'upload' : wantsTts ? 'tts' : 'none',
        queuedMs,
      },
      jobId,
    );

    setStage('audio');
    let audioFile;
    if (wantsUpload) {
      try {
        audioFile = await writeAudioFile(workDir, input.audioBase64, input.audioMime);
        summary.audio = 'upload';
        diag.info('audio.written', { bytes: (await fs.stat(audioFile)).size }, jobId);
      } catch (error) {
        audioFile = undefined;
        warnings.push(`audio_failed: ${cleanString(error?.message ?? error).slice(0, 120)}`);
        diag.warn('audio.fail', { message: error?.message ?? String(error) }, jobId);
      }
    } else if (wantsTts) {
      const ttsStart = Date.now();
      diag.info('tts.start', { chars: String(input.ttsText).length, voice: input.ttsVoice }, jobId);
      try {
        audioFile = await ctx.ttsImpl(input.ttsText.trim(), input.ttsVoice, workDir, {
          signal: guard.abort.signal,
        });
        summary.audio = 'tts';
        timings.ttsMs = Date.now() - ttsStart;
        diag.info('tts.ok', { ms: timings.ttsMs, bytes: (await fs.stat(audioFile)).size }, jobId);
      } catch (error) {
        audioFile = undefined;
        timings.ttsMs = Date.now() - ttsStart;
        warnings.push(`tts_failed: ${cleanString(error?.message ?? error).slice(0, 120)}`);
        diag.warn('tts.fail', { ms: timings.ttsMs, message: error?.message ?? String(error) }, jobId);
      }
    }

    let audioSec = null;
    if (audioFile) {
      audioSec = await ctx.probeImpl(audioFile);
      diag.info('audio.probe', { audioSec }, jobId);
      mediaId = crypto.randomUUID();
      ctx.media.set(mediaId, { file: audioFile, name: path.basename(audioFile) });
    }
    const audioSrc = mediaId
      ? `http://127.0.0.1:${ctx.getPort()}/media/${mediaId}/${path.basename(audioFile)}`
      : undefined;

    const outWidth = styleFilm ? 1080 : width;
    const outHeight = styleFilm ? 1350 : height;
    const outSec = styleFilm
      ? Math.min(
          THEMES_3D.has(theme) ? STYLE_FILM_3D_MAX_SEC : STYLE_FILM_MAX_SEC,
          Math.max(1, requestedSec, audioSec ?? 0),
        )
      : requestedSec;
    const outDurationFrames = Math.max(MIN_FRAMES, Math.round(outSec * FPS));
    const inputProps = {
      title,
      theme,
      brandName,
      brandColor,
      scenes,
      ...(styleFilm ? { durationSec: outDurationFrames / FPS } : {}),
      ...(audioSrc ? { audioSrc } : {}),
    };
    Object.assign(summary, { frames: outDurationFrames, width: outWidth, height: outHeight });

    setStage('bundle');
    diag.info('bundle.wait', { state: ctx.bundles.snapshot().state }, jobId);
    const bundleStart = Date.now();
    const serveUrl = await ctx.bundles.get();
    timings.bundleMs = Date.now() - bundleStart;

    setStage('select');
    const selectStart = Date.now();
    const composition = await ctx.selectImpl({
      serveUrl,
      id: styleFilm ? 'HiveGPTStyledFilm' : 'HiveGPTClip',
      inputProps,
      ...ctx.browserOptions,
    });
    timings.selectMs = Date.now() - selectStart;
    diag.info('select.ok', { ms: timings.selectMs, frames: composition?.durationInFrames }, jobId);

    setStage('render');
    const outputPath = path.join(workDir, 'out.mp4');
    const renderStart = Date.now();
    let nextMark = 25;
    let browserLogs = 0;
    await ctx.renderImpl({
      composition: {
        ...composition,
        width: outWidth,
        height: outHeight,
        fps: FPS,
        durationInFrames: outDurationFrames,
      },
      serveUrl,
      codec: 'h264',
      imageFormat: 'jpeg',
      crf: CRF,
      outputLocation: outputPath,
      inputProps,
      concurrency: RENDER_CONCURRENCY,
      cancelSignal,
      ...ctx.browserOptions,
      chromiumOptions: {
        disableWebSecurity: false,
        gl: process.env.REMOTION_GL || 'angle',
      },
      timeoutInMilliseconds: 240_000,
      onProgress: ({ progress, renderedFrames, encodedFrames }) => {
        const pct = Math.floor((progress ?? 0) * 100);
        while (pct >= nextMark && nextMark <= 100) {
          diag.info(
            'render.progress',
            { pct: nextMark, renderedFrames, encodedFrames, ms: Date.now() - renderStart },
            jobId,
          );
          nextMark += 25;
        }
      },
      onBrowserLog: (entry) => {
        if (browserLogs >= 20 || (entry?.type !== 'error' && entry?.type !== 'warning')) {
          return;
        }
        browserLogs += 1;
        diag.warn('browser.log', { type: entry.type, chars: String(entry.text ?? '').length }, jobId);
      },
    });
    timings.renderMs = Date.now() - renderStart;

    setStage('read');
    const buffer = await fs.readFile(outputPath);
    const totalMs = Date.now() - started;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    diag.info('render.ok', { ms: timings.renderMs, bytes: buffer.length, totalMs }, jobId);
    diag.recordJob({
      ...summary,
      stage: 'done',
      ok: true,
      bytes: buffer.length,
      ...timings,
      totalMs,
      peakRssMb: toMb(peakRss),
      warnings: warnings.length ? warnings : undefined,
    });
    return {
      ok: true,
      jobId,
      videoBase64: buffer.toString('base64'),
      mime: 'video/mp4',
      width: outWidth,
      height: outHeight,
      /** The rendered length (style films loop up to the cap). */
      durationSec: outDurationFrames / FPS,
      renderMs: totalMs,
      timings,
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    if (guard.abandoned) {
      // The deadline already answered and recorded this job; only clean up.
      throw error;
    }
    if (timeout.hit) {
      error.code = 'timeout';
      error.message = `Job exceeded ${ctx.jobTimeoutMs}ms at stage ${summary.stage}`;
    }
    error.code ||= 'render_failed';
    error.stage = summary.stage;
    error.detail = cleanString(String(error.message).split('\n')[0]);
    error.jobId = jobId;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    diag.error(
      'job.fail',
      { stage: error.stage, code: error.code, message: error.message, stack: stackHead(error) },
      jobId,
    );
    diag.recordJob({
      ...summary,
      ok: false,
      error: error.code,
      message: error.message,
      ...timings,
      totalMs: Date.now() - started,
      peakRssMb: toMb(peakRss),
    });
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(sampler);
    if (mediaId) {
      ctx.media.delete(mediaId);
    }
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Runs one render and enforces the job deadline as a hard limit. The cooperative cancel only
 * reaches `renderMedia`; a hang in bundle, select or TTS would otherwise hold the queue slot
 * forever, so the deadline (timeout + grace) rejects regardless of the stage and aborts the TTS child.
 */
async function renderJob(ctx, input, queuedMs) {
  const guard = { abandoned: false, abort: new AbortController() };
  const inner = renderJobInner(ctx, input, queuedMs, guard);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      guard.abandoned = true;
      guard.cancel?.();
      guard.abort.abort();
      const stage = guard.summary?.stage ?? 'init';
      const error = makeError('timeout', `Job exceeded ${ctx.jobTimeoutMs}ms at stage ${stage}`);
      Object.assign(error, {
        stage,
        detail: cleanString(error.message),
        ...(guard.jobId ? { jobId: guard.jobId } : {}),
      });
      ctx.diag.error(
        'job.fail',
        { stage, code: 'timeout', message: error.message, abandoned: true },
        guard.jobId,
      );
      ctx.diag.recordJob({
        ...(guard.summary ?? {}),
        ok: false,
        error: 'timeout',
        message: error.message,
      });
      reject(error);
    }, ctx.jobTimeoutMs + (ctx.jobGraceMs ?? 5000));
    timer.unref?.();
  });
  inner.catch(() => undefined);
  try {
    return await Promise.race([inner, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** FIFO queue: at most maxConcurrent renders; extras wait; overflow is rejected. */
export function createQueue(maxConcurrent, maxQueue) {
  let active = 0;
  const waiting = [];

  const pump = () => {
    while (active < maxConcurrent && waiting.length > 0) {
      const next = waiting.shift();
      active += 1;
      const queuedMs = Date.now() - next.enqueuedAt;
      next
        .run(queuedMs)
        .then((result) => next.resolve({ ...result, queuedMs }))
        .catch(next.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return {
    stats: () => ({ active, waiting: waiting.length, maxConcurrent, maxQueue }),
    enqueue(run) {
      if (active >= maxConcurrent && waiting.length >= maxQueue) {
        const error = new Error('queue_full');
        error.code = 'busy';
        error.status = 429;
        error.message = `The Remotion queue is full (${maxConcurrent} running, ${maxQueue} waiting).`;
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        waiting.push({ run, resolve, reject, enqueuedAt: Date.now() });
        pump();
      });
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

/**
 * `bundleImpl`, `selectImpl`, `renderImpl`, `ttsImpl` and `probeImpl` are injectable so tests
 * run without Chromium. `server.media` lets tests register files for /media.
 */
export function createServer({
  token = TOKEN,
  diagnostics = createDiagnostics(),
  bundleImpl = bundle,
  selectImpl = selectComposition,
  renderImpl = renderMedia,
  ttsImpl = synthesizeTts,
  probeImpl = probeAudioSec,
  jobTimeoutMs = JOB_TIMEOUT_MS,
  jobGraceMs = 5000,
  browserOptions = process.env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
    : {},
} = {}) {
  const diag = diagnostics;
  const queue = createQueue(MAX_CONCURRENT, MAX_QUEUE);
  const bundles = createBundleManager({ bundleImpl, diag });
  const startedAt = Date.now();
  const ctx = {
    diag,
    bundles,
    media: new Map(),
    selectImpl,
    renderImpl,
    ttsImpl,
    probeImpl,
    jobTimeoutMs,
    jobGraceMs,
    browserOptions,
    getPort: () => server.address()?.port ?? PORT,
  };
  const health = () => ({
    ok: true,
    ...queue.stats(),
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
          config: effectiveConfig(),
          memory: memorySnapshot(),
          counters: diag.counters(),
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
      if (req.method === 'POST' && url.pathname === '/render') {
        const body = await readBody(req);
        const result = await queue.enqueue((queuedMs) => renderJob(ctx, body, queuedMs));
        return send(res, 200, result);
      }
      return send(res, 404, { error: 'not_found', message: 'Not found' });
    } catch (error) {
      const code = error?.code || 'render_failed';
      const status = error?.status || (code === 'busy' ? 429 : code === 'timeout' ? 504 : 500);
      if (!error?.jobId) {
        diag.warn('request.fail', { code, status, message: error?.message ?? String(error) });
      }
      return send(res, status, {
        ok: false,
        error: code,
        message: error?.message || 'Render failed',
        ...(error?.stage ? { stage: error.stage } : {}),
        ...(error?.detail ? { detail: error.detail } : {}),
        ...(error?.jobId ? { jobId: error.jobId } : {}),
      });
    }
  });
  server.diagnostics = diag;
  server.bundles = bundles;
  server.media = ctx.media;
  return server;
}

/** Startup self-check of the external binaries the worker shells out to. */
export async function runSelfCheck(diag) {
  const chromium = process.env.REMOTION_BROWSER_EXECUTABLE;
  const [chrome, ffmpeg, ffprobe, edgeTts] = await Promise.all([
    chromium
      ? runCheck(chromium, ['--version'])
      : Promise.resolve({ found: true, version: 'remotion-managed browser' }),
    runCheck('ffmpeg', ['-version']),
    runCheck('ffprobe', ['-version']),
    runCheck('edge-tts', ['--version']),
  ]);
  const checks = { chromium: chrome, ffmpeg, ffprobe, edgeTts };
  for (const [name, result] of Object.entries(checks)) {
    diag.log(result.found ? 'info' : 'warn', 'selfcheck', { name, ...result });
  }
  return checks;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!TOKEN || TOKEN.length < 32) {
    console.error('[remotion] REMOTION_SERVICE_TOKEN must be at least 32 characters');
    process.exit(1);
  }
  const server = createServer();
  const diag = server.diagnostics;
  process.on('unhandledRejection', (reason) => {
    diag.error('process.unhandledRejection', {
      message: reason?.message ?? String(reason),
      stack: stackHead(reason),
    });
  });
  process.on('uncaughtException', (error) => {
    diag.error('process.uncaughtException', {
      message: error?.message ?? String(error),
      stack: stackHead(error),
    });
    process.exit(1);
  });
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
