// Real renders with Chromium (Remotion's headless shell, or REMOTION_BROWSER_EXECUTABLE).
// Skipped unless REMOTION_E2E=1. These are the quality gates: no blank key frame for any scene
// type in either language, no text overflow in the samples (and a forced overflow is caught),
// and a full MP4 render of a storyboard holding every scene type.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { createServer } from '../src/server.mjs';
import { probeAudioSec } from '../src/tts.mjs';
import { everySceneEn, everySceneFa, photoAsset } from './fixtures.mjs';
import { encodePng, pngStats } from './helpers.mjs';

const TOKEN = 'e'.repeat(40);
const E2E = process.env.REMOTION_E2E === '1';
const json = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

test('the blank-frame detector flags a uniform frame', () => {
  assert.ok(pngStats(encodePng(64, 64, () => [20, 30, 40])).std < 0.5);
  assert.ok(pngStats(encodePng(64, 64, (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]))).std > 100);
});

async function withWorker(fn) {
  const server = createServer({ token: TOKEN, diagnostics: createDiagnostics({ print: false }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const stills = async (base, storyboard) => {
  const res = await fetch(`${base}/stills`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ storyboard, assets: { photo: photoAsset() }, stills: 30, format: 'png', maxDurationSec: 180 }),
  });
  const body = await res.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  return body;
};

test('every scene type renders a non-blank key frame without overflow (en 16:9, fa 9:16)', { skip: !E2E, timeout: 600_000 }, async () => {
  await withWorker(async (base) => {
    for (const board of [everySceneEn, everySceneFa]) {
      const body = await stills(base, board);
      assert.equal(body.stills.length, board.scenes.length);
      body.stills.forEach((still, i) => {
        const stats = pngStats(Buffer.from(still.base64, 'base64'));
        assert.ok(stats.std > 8, `${board.lang} scene ${i} (${board.scenes[i].type}) looks blank: std=${stats.std.toFixed(2)}`);
      });
      assert.deepEqual(body.warnings.filter((w) => w.startsWith('text_overflow')), [], `${board.lang} overflow`);
    }
  });
});

test('square 1:1 and 4:5 layouts render without overflow', { skip: !E2E, timeout: 600_000 }, async () => {
  await withWorker(async (base) => {
    for (const aspectRatio of ['1:1', '4:5']) {
      const body = await stills(base, { ...everySceneEn, aspectRatio });
      for (const still of body.stills) {
        assert.ok(pngStats(Buffer.from(still.base64, 'base64')).std > 8);
      }
      assert.deepEqual(body.warnings.filter((w) => w.startsWith('text_overflow')), [], aspectRatio);
    }
  });
});

test('text that cannot fit is cut and reported, never drawn outside its box', { skip: !E2E, timeout: 300_000 }, async () => {
  await withWorker(async (base) => {
    const body = await stills(base, {
      title: 'overflow',
      aspectRatio: '9:16',
      scenes: [{ type: 'hook', durationSec: 2, headline: `${'W'.repeat(60)} ${'M'.repeat(29)}` }],
    });
    assert.ok(body.warnings.includes('text_overflow: s0.headline'), JSON.stringify(body.warnings));
  });
});

test('a full MP4 of every scene type with music', { skip: !E2E, timeout: 1_500_000 }, async () => {
  await withWorker(async (base) => {
    const storyboard = { ...everySceneEn, scenes: everySceneEn.scenes.map((s) => ({ ...s, durationSec: 1.5 })), music: { track: 'pulse', volume: 0.3 } };
    const t0 = Date.now();
    const created = await (
      await fetch(`${base}/jobs`, { method: 'POST', headers: json, body: JSON.stringify({ storyboard, assets: { photo: photoAsset() }, shortSide: 540 }) })
    ).json();
    assert.equal(created.ok, true, JSON.stringify(created));
    let job = created;
    while (job.state === 'queued' || job.state === 'running') {
      await new Promise((r) => setTimeout(r, 1000));
      job = await (await fetch(`${base}/jobs/${created.jobId}`, { headers: json })).json();
    }
    assert.equal(job.state, 'done', JSON.stringify(job));
    const video = Buffer.from(await (await fetch(`${base}/jobs/${created.jobId}/video`, { headers: json })).arrayBuffer());
    assert.ok(video.length > 50_000);
    console.log(`E2E every-scene mp4: ms=${Date.now() - t0} bytes=${video.length} frames=${job.frames?.total} timings=${JSON.stringify(job.timings)} warnings=${JSON.stringify(job.warnings)}`);
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const file = `${os.tmpdir()}/every-scene-${process.pid}.mp4`;
    await fs.writeFile(file, video);
    const sec = await probeAudioSec(file);
    await fs.rm(file, { force: true });
    if (sec != null) {
      assert.ok(Math.abs(sec - storyboard.scenes.length * 1.5) < 0.3, `duration ${sec}`);
    }
  });
});

// Needs network (Microsoft Edge TTS) and edge-tts 7.3.1 (REMOTION_TTS_PYTHON may point at a venv).
test('Persian narration with word-synced captions and ducked music', { skip: !E2E || process.env.REMOTION_E2E_TTS !== '1', timeout: 900_000 }, async () => {
  await withWorker(async (base) => {
    const storyboard = {
      title: 'tts',
      lang: 'fa',
      aspectRatio: '9:16',
      captions: true,
      music: { track: 'ambient', volume: 0.25 },
      scenes: [
        { type: 'hook', durationSec: 1, headline: 'انرژی خورشیدی', narration: 'انرژی خورشیدی ارزان‌ترین برق دنیاست.' },
        { type: 'stat', durationSec: 1, value: 30, suffix: '٪', label: 'تجدیدپذیر', narration: 'سی درصد برق جهان پاک است.' },
      ],
    };
    const created = await (await fetch(`${base}/jobs`, { method: 'POST', headers: json, body: JSON.stringify({ storyboard, audio: { mode: 'tts' }, shortSide: 360 }) })).json();
    let job = created;
    while (job.state === 'queued' || job.state === 'running') {
      await new Promise((r) => setTimeout(r, 1000));
      job = await (await fetch(`${base}/jobs/${created.jobId}`, { headers: json })).json();
    }
    assert.equal(job.state, 'done', JSON.stringify(job));
    assert.deepEqual(job.warnings.filter((w) => w.startsWith('tts_failed')), []);
    assert.ok(job.timings.ttsMs > 0);
    /** Both 1 s scenes were stretched to fit their narration. */
    assert.ok(job.durationSec > 3, `durationSec ${job.durationSec}`);
  });
});
