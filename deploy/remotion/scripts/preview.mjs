// Dev helper: render key-frame stills (POST /stills) or a full clip (POST /jobs) for a
// storyboard JSON file and write them to an output directory.
//   node scripts/preview.mjs stills <storyboard.json|fixture:everySceneFa> <outDir>
//   node scripts/preview.mjs video  <storyboard.json|fixture:name> <outDir> [tts|none] [track]
import fs from 'node:fs/promises';
import path from 'node:path';
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
    const file = path.join(outDir, `${path.basename(source).replace(/[^a-z0-9-]+/gi, '-')}.mp4`);
    await fs.writeFile(file, video);
    console.log(`video=${file} bytes=${video.length} durationSec=${job.durationSec} size=${job.width}x${job.height} ms=${Date.now() - t0} timings=${JSON.stringify(job.timings)} warnings=${JSON.stringify(job.warnings)}`);
  }
} finally {
  server.close();
}
