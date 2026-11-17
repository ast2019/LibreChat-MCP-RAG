import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3200);
const TOKEN = (process.env.REMOTION_SERVICE_TOKEN || '').trim();
const MAX_CONCURRENT = Math.min(4, Math.max(1, Number(process.env.REMOTION_MAX_CONCURRENT || 2)));
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


let bundleLocationPromise;
const getBundle = () => {
  bundleLocationPromise ??= bundle({
    entryPoint: ENTRY,
    webpackOverride: (config) => config,
  });
  return bundleLocationPromise;
};

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
const synthesizeTts = async (text, voice, workDir) => {
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
      { stdio: ['ignore', 'pipe', 'pipe'] },
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
        reject(new Error(err || `edge-tts exited ${code}`));
      }
    });
  });
  return out;
};

const writeAudioFile = async (workDir, base64, mime) => {
  const ext =
    typeof mime === 'string' && mime.includes('wav')
      ? 'wav'
      : typeof mime === 'string' && mime.includes('m4a')
        ? 'm4a'
        : 'mp3';
  const file = path.join(workDir, `audio.${ext}`);
  await fs.writeFile(file, Buffer.from(base64, 'base64'));
  return file;
};

async function renderJob(input) {
  const started = Date.now();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hivegpt-clip-'));
  try {
    const scenes = parseScenes(input.scenes);
    if (!scenes) {
      const error = new Error('invalid_scenes');
      error.code = 'invalid_input';
      error.status = 400;
      throw error;
    }
    const sceneSum = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
    const durationSec = Math.min(
      MAX_DURATION_SEC,
      clampDuration(input.durationSec) ?? sceneSum,
    );
    const width = Math.min(1920, Math.max(360, Math.round(Number(input.width) || 405)));
    const height = Math.min(1920, Math.max(360, Math.round(Number(input.height) || 720)));
    const fps = 30;
    const theme = THEMES.has(input.theme) ? input.theme : 'brand-dark';
    const brandName = String(input.brandName || 'HiveGPT').slice(0, 40);
    const brandColor =
      typeof input.brandColor === 'string' && HEX.test(input.brandColor.trim())
        ? input.brandColor.trim()
        : '#2ea884';
    const title = String(input.title || 'clip').slice(0, 120);

    let audioSrc;
    if (typeof input.audioBase64 === 'string' && input.audioBase64.length > 0) {
      const file = await writeAudioFile(workDir, input.audioBase64, input.audioMime);
      audioSrc = `file://${file}`;
    } else if (typeof input.ttsText === 'string' && input.ttsText.trim()) {
      try {
        const file = await synthesizeTts(input.ttsText.trim(), input.ttsVoice, workDir);
        audioSrc = `file://${file}`;
      } catch (error) {
        console.warn('[remotion] TTS failed; rendering without audio', error?.message ?? error);
      }
    }

    const serveUrl = await getBundle();
    const styleFilm = STYLE_FILM_THEMES.has(theme);
    const inputProps = {
      title,
      theme,
      brandName,
      brandColor,
      scenes,
      ...(audioSrc ? { audioSrc } : {}),
    };
    const compositionId = styleFilm ? 'HiveGPTStyledFilm' : 'HiveGPTClip';
    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
    });
    const outWidth = styleFilm ? 1080 : width;
    const outHeight = styleFilm ? 1350 : height;
    const outDurationFrames = styleFilm
      ? 150
      : Math.max(1, Math.round(durationSec * fps));
    const outputPath = path.join(workDir, 'out.mp4');
    await renderMedia({
      composition: {
        ...composition,
        width: outWidth,
        height: outHeight,
        fps,
        durationInFrames: outDurationFrames,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      ...(process.env.REMOTION_BROWSER_EXECUTABLE
        ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
        : {}),
      chromiumOptions: {
        disableWebSecurity: false,
        gl: process.env.REMOTION_GL || 'angle',
      },
      timeoutInMilliseconds: 240_000,
    });
    const buffer = await fs.readFile(outputPath);
    return {
      ok: true,
      videoBase64: buffer.toString('base64'),
      mime: 'video/mp4',
      width: outWidth,
      height: outHeight,
      /** Always the rendered length (style films are fixed at 5s / 150 frames). */
      durationSec: outDurationFrames / fps,
      renderMs: Date.now() - started,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** FIFO queue: at most MAX_CONCURRENT renders; extras wait; overflow is rejected. */
function createQueue(maxConcurrent, maxQueue) {
  let active = 0;
  const waiting = [];

  const pump = () => {
    while (active < maxConcurrent && waiting.length > 0) {
      const next = waiting.shift();
      active += 1;
      const queuedMs = Date.now() - next.enqueuedAt;
      next
        .run()
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

const queue = createQueue(MAX_CONCURRENT, MAX_QUEUE);

export function createServer({ token = TOKEN } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://remotion');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, ...queue.stats() });
      }
      if (!sameToken(req.headers.authorization, token)) {
        return send(res, 401, { error: 'unauthorized', message: 'Unauthorized' });
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(res, 200, { ok: true, ...queue.stats() });
      }
      if (req.method === 'POST' && url.pathname === '/render') {
        const body = await readBody(req);
        const result = await queue.enqueue(() => renderJob(body));
        return send(res, 200, result);
      }
      return send(res, 404, { error: 'not_found', message: 'Not found' });
    } catch (error) {
      const status = error?.status || (error?.code === 'busy' ? 429 : 500);
      const code = error?.code || 'render_failed';
      console.error('[remotion]', code, error?.message ?? error);
      return send(res, status, {
        ok: false,
        error: code,
        message: error?.message || 'Render failed',
      });
    }
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!TOKEN || TOKEN.length < 32) {
    console.error('[remotion] REMOTION_SERVICE_TOKEN must be at least 32 characters');
    process.exit(1);
  }
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[remotion] listening on ${PORT} (maxConcurrent=${MAX_CONCURRENT})`);
  });
}
