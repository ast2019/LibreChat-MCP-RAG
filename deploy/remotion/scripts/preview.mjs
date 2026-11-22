// Dev helper: render key-frame stills (POST /stills) or a full clip (POST /jobs) for a
// storyboard JSON file and write them to an output directory.
//   node scripts/preview.mjs stills <storyboard.json|fixture:everySceneFa> <outDir>
//   node scripts/preview.mjs video  <storyboard.json|fixture:name> <outDir> [tts|none] [track]
//   node scripts/preview.mjs transitions <storyboard.json|fixture:name> <outDir>
// `transitions` renders PNGs at 25%, 50% and 75% of every scene transition (ALL_TYPES=1 also
// tries the transition types the storyboard does not use). With FRAMES_DIR set,
// `video` also writes the midpoint frames of the rendered MP4 there (needs ffmpeg on PATH or
// Remotion's bundled one).
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { FPS, computeTimeline } from '../src/storyboard.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { createServer } from '../src/server.mjs';
import * as fixtures from '../test/fixtures.mjs';

const [mode = 'stills', source = 'fixture:everySceneFa', outDir = 'out', audio = 'none', track] = process.argv.slice(2);
const TOKEN = 'p'.repeat(40);
const storyboard = source.startsWith('fixture:') ? fixtures[source.slice(8)] : JSON.parse(await fs.readFile(source, 'utf8'));
if (track) {
  storyboard.music = { track, volume: 0.25 };
}
const body = {
  storyboard,
  assets: { photo: fixtures.photoAsset() },
  audio: { mode: audio },
  maxDurationSec: 180,
  stills: 30,
  timeoutMs: 1_500_000,
};
await fs.mkdir(outDir, { recursive: true });
const server = createServer({ token: TOKEN, diagnostics: createDiagnostics({ print: process.env.VERBOSE === '1' }) });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const t0 = Date.now();
const slug = path.basename(source).replace(/^fixture:/, '').replace(/[^a-z0-9-]+/gi, '-');

/** Midpoint frame of each transition: the incoming scene starts it, it lasts `transitionOut`. */
const midpoints = (scenes) =>
  scenes.flatMap((entry, i) =>
    entry.transitionOut > 0 && scenes[i + 1]
      ? [{ index: i + 1, frame: scenes[i + 1].from + Math.floor(entry.transitionOut / 2) }]
      : [],
  );
const transitionName = (index) => storyboard.scenes[index]?.transition ?? 'fade';
const TRANSITION_TYPES = ['fade', 'slide', 'wipe', 'flip', 'clock-wipe'];
/** Frames at 25%, 50% and 75% of each transition. */
const transitionFrames = (scenes) =>
  scenes.flatMap((entry, i) =>
    entry.transitionOut > 0 && scenes[i + 1]
      ? [25, 50, 75].map((pct) => ({ index: i + 1, pct, frame: scenes[i + 1].from + Math.round((entry.transitionOut * pct) / 100) }))
      : [],
  );

function ffmpegBinary() {
  if (spawnSync('ffmpeg', ['-version']).status === 0) {
    return { bin: 'ffmpeg', env: process.env };
  }
  const dir = path.dirname(createRequire(import.meta.url).resolve('@remotion/compositor-linux-x64-gnu/package.json'));
  return { bin: path.join(dir, 'ffmpeg'), env: { ...process.env, LD_LIBRARY_PATH: dir } };
}

try {
  if (mode === 'stills') {
    const res = await fetch(`${base}/stills`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(JSON.stringify(json));
    }
    for (const [i, still] of json.stills.entries()) {
      await fs.writeFile(path.join(outDir, `still-${String(i).padStart(2, '0')}.jpg`), Buffer.from(still.base64, 'base64'));
    }
    console.log(`stills=${json.stills.length} ms=${Date.now() - t0} warnings=${JSON.stringify(json.warnings)}`);
  } else if (mode === 'transitions') {
    /**
     * Every transition of the storyboard at 25%, 50% and 75% of its length. With ALL_TYPES=1,
     * a type the storyboard does not use is tried in place of one of its fades, so every type
     * is seen on every storyboard (those files are marked `-sub`).
     */
    const boards = [{ board: storyboard, only: null, tag: '' }];
    if (process.env.ALL_TYPES === '1') {
      const used = new Set(storyboard.scenes.slice(1).map((s) => s.transition ?? 'fade'));
      const fades = storyboard.scenes.map((s, i) => (i > 0 && (s.transition ?? 'fade') === 'fade' ? i : -1)).filter((i) => i > 0);
      const missing = TRANSITION_TYPES.filter((type) => !used.has(type));
      for (const [k, type] of missing.entries()) {
        const index = fades[k % fades.length];
        const board = { ...storyboard, scenes: storyboard.scenes.map((s, i) => (i === index ? { ...s, transition: type } : s)) };
        boards.push({ board, only: index, tag: '-sub' });
      }
    }
    let count = 0;
    for (const { board, only, tag } of boards) {
      const scenes = computeTimeline(board.scenes.map((scene) => ({ ...scene, transition: scene.transition ?? 'fade' }))).scenes;
      const points = transitionFrames(scenes).filter((p) => only === null || p.index === only);
      for (let at = 0; at < points.length; at += 30) {
        const batch = points.slice(at, at + 30);
        const res = await fetch(`${base}/stills`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ ...body, storyboard: board, frames: batch.map((p) => p.frame), format: 'png', scale: 1 }),
        });
        const json = await res.json();
        if (!json.ok) {
          throw new Error(JSON.stringify(json));
        }
        for (const [i, still] of json.stills.entries()) {
          const { index, frame, pct } = batch[i];
          const name = board.scenes[index].transition ?? 'fade';
          const file = `${slug}-t${String(index).padStart(2, '0')}-${name}${tag}-p${pct}-f${frame}.png`;
          await fs.writeFile(path.join(outDir, file), Buffer.from(still.base64, 'base64'));
          count += 1;
        }
      }
    }
    console.log(`transition frames=${count} ms=${Date.now() - t0}`);
  } else {
    const created = await (await fetch(`${base}/jobs`, { method: 'POST', headers: auth, body: JSON.stringify(body) })).json();
    if (!created.ok) {
      throw new Error(JSON.stringify(created));
    }
    let job = created;
    while (job.state === 'queued' || job.state === 'running') {
      await new Promise((r) => setTimeout(r, 2000));
      job = await (await fetch(`${base}/jobs/${created.jobId}`, { headers: auth })).json();
      process.stdout.write(`\r${job.stage} ${Math.round(job.progress * 100)}%   `);
    }
    console.log('');
    if (job.state !== 'done') {
      throw new Error(JSON.stringify(job));
    }
    const video = Buffer.from(await (await fetch(`${base}/jobs/${created.jobId}/video`, { headers: auth })).arrayBuffer());
    const file = path.join(outDir, `${slug}.mp4`);
    await fs.writeFile(file, video);
    if (process.env.FRAMES_DIR && job.scenes) {
      await fs.mkdir(process.env.FRAMES_DIR, { recursive: true });
      const { bin, env } = ffmpegBinary();
      for (const { index, frame } of midpoints(job.scenes)) {
        const png = path.join(process.env.FRAMES_DIR, `${slug}-t${String(index).padStart(2, '0')}-${transitionName(index)}-f${frame}.png`);
        const out = spawnSync(bin, ['-y', '-loglevel', 'error', '-ss', ((frame + 0.25) / FPS).toFixed(4), '-i', file, '-frames:v', '1', png], { env });
        if (out.status !== 0) {
          throw new Error(`ffmpeg failed for frame ${frame}: ${out.stderr}`);
        }
      }
      console.log(`transition frames written to ${process.env.FRAMES_DIR}`);
    }
    console.log(`video=${file} bytes=${video.length} durationSec=${job.durationSec} size=${job.width}x${job.height} ms=${Date.now() - t0} timings=${JSON.stringify(job.timings)} warnings=${JSON.stringify(job.warnings)}`);
  }
} finally {
  server.close();
}
