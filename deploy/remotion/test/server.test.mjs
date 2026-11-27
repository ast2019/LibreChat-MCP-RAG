import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { createBundleManager, createServer } from '../src/server.mjs';

const TOKEN = 't'.repeat(40);
const auth = { Authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'Content-Type': 'application/json' };

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const storyboard = (extra = {}) => ({
  title: 'Energy',
  scenes: [
    { type: 'hook', durationSec: 2, headline: 'Hello', narration: 'Hello there' },
    { type: 'stat', durationSec: 2, value: 42, label: 'answer' },
  ],
  ...extra,
});

const fakeImpls = (calls = {}) => ({
  bundleImpl: async () => 'http://bundle',
  selectImpl: async (opts) => {
    calls.select = opts;
    return { id: opts.id, width: 1, height: 1, fps: 30, durationInFrames: 60, props: {} };
  },
  renderImpl: async (opts) => {
    calls.render = opts;
    opts.onProgress?.({ progress: 0.5, renderedFrames: 30, encodedFrames: 30 });
    opts.onBrowserLog?.({ type: 'warning', text: '[hivegpt:overflow] s0.headline' });
    opts.onBrowserLog?.({ type: 'error', text: 'secret user text here' });
    opts.onProgress?.({ progress: 1, renderedFrames: 60, encodedFrames: 60 });
    await fs.writeFile(opts.outputLocation, Buffer.from('fakemp4'));
  },
  stillImpl: async () => ({ buffer: Buffer.from('jpeg') }),
  ttsImpl: async (scenes, voice, workDir) => {
    calls.tts = { voice, scenes: scenes.length };
    const file = path.join(workDir, 'tts-0.mp3');
    await fs.writeFile(file, Buffer.alloc(1000));
    return [{ index: 0, file, words: [{ text: 'Hello', startMs: 0, endMs: 400 }, { text: 'there', startMs: 450, endMs: 900 }] }];
  },
  probeImpl: async () => 3.5,
});

const withServer = async (opts, fn) => {
  const diagnostics = createDiagnostics({ print: false });
  const server = createServer({ token: TOKEN, diagnostics, resultTtlMs: 60_000, ...opts });
  const port = await listen(server);
  try {
    await fn({ base: `http://127.0.0.1:${port}`, server, diagnostics });
  } finally {
    server.close();
  }
};

const post = (base, body, route = '/jobs') => fetch(`${base}${route}`, { method: 'POST', headers: json, body: JSON.stringify(body) });

async function waitFor(base, id, states = ['done', 'failed', 'cancelled']) {
  for (let i = 0; i < 200; i += 1) {
    const job = await (await fetch(`${base}/jobs/${id}`, { headers: auth })).json();
    if (states.includes(job.state)) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not settle');
}

test('health is public; status, logs and jobs need the token', async () => {
  await withServer(fakeImpls(), async ({ base }) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.bundle, 'idle');
    for (const p of ['/status', '/logs', '/jobs/abcdef123456']) {
      assert.equal((await fetch(`${base}${p}`)).status, 401, p);
    }
    assert.equal((await fetch(`${base}/jobs`, { method: 'POST' })).status, 401);
    const status = await (await fetch(`${base}/status`, { headers: auth })).json();
    assert.ok(status.config.renderConcurrency >= 1 && status.config.cpus >= 1);
    assert.equal(status.config.maxConcurrent, 1);
    assert.ok(Array.isArray(status.activeJobs));
  });
});

test('an invalid storyboard is refused at once with every error path', async () => {
  await withServer(fakeImpls(), async ({ base }) => {
    const res = await post(base, { storyboard: { title: 'x', scenes: [{ type: 'chart', durationSec: 2, data: [] }] } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_storyboard');
    assert.match(body.errors.join(), /scenes\[0\]\.data: must have 2-8 items/);
  });
});

test('job lifecycle: 202 at once, progress and stage, MP4 download, overflow warning', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base, diagnostics }) => {
    const res = await post(base, { storyboard: storyboard(), audio: { mode: 'none' }, timeoutMs: 120_000 });
    assert.equal(res.status, 202);
    const created = await res.json();
    assert.match(created.jobId, /^[a-f0-9-]{12}$/);
    assert.equal(created.timeoutMs, 120_000);
    const job = await waitFor(base, created.jobId);
    assert.equal(job.state, 'done');
    assert.equal(job.stage, 'done');
    assert.equal(job.progress, 1);
    assert.equal(job.durationSec, 4);
    assert.equal(`${job.width}x${job.height}`, '720x1280');
    assert.deepEqual(job.warnings, ['text_overflow: s0.headline']);
    const video = await fetch(`${base}/jobs/${created.jobId}/video`, { headers: auth });
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    assert.equal(await video.text(), 'fakemp4');
    assert.equal(calls.render.composition.durationInFrames, 120);
    assert.ok(calls.render.cancelSignal, 'renderMedia gets a cancel signal');
    assert.ok(calls.render.inputProps.icons.sparkles, 'builtin icons are sent');
    const logs = JSON.stringify(diagnostics.getLogs({ limit: 500 }));
    assert.doesNotMatch(logs, /secret user text/);
  });
});

test('TTS lengthens a scene to fit its narration and places word timings', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base }) => {
    const created = await (await post(base, { storyboard: storyboard({ lang: 'fa' }), audio: { mode: 'tts' } })).json();
    const job = await waitFor(base, created.jobId);
    assert.equal(job.state, 'done');
    assert.equal(calls.tts.voice, 'fa-IR-DilaraNeural');
    const props = calls.render.inputProps;
    // 3.5 s of speech + 8 frames lead + 0.6 s tail -> 4.4 s
    assert.equal(props.storyboard.scenes[0].durationSec, 4.4);
    assert.equal(props.timeline.totalFrames, Math.round(4.4 * 30) + 60);
    assert.equal(props.narration[0].from, 8);
    assert.deepEqual(props.words[1], { text: 'there', start: 8 + 14, end: 8 + 27 });
  });
});

const wavAsset = { kind: 'audio', mime: 'audio/wav', base64: Buffer.alloc(64).toString('base64') };

test('scenes audio lengthens a scene to its own audio and times captions by characters', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base }) => {
    const body = { storyboard: storyboard(), assets: { 'nar-0': wavAsset }, audio: { mode: 'scenes', lines: { 0: 'nar-0' } } };
    const created = await (await post(base, body)).json();
    const job = await waitFor(base, created.jobId);
    assert.equal(job.state, 'done');
    assert.equal(calls.tts, undefined, 'Edge is not called');
    const props = calls.render.inputProps;
    // 3.5 s of audio + 8 frames lead + 0.6 s tail -> 4.4 s; the 2 s scene grows, the other stays
    assert.equal(props.storyboard.scenes[0].durationSec, 4.4);
    assert.equal(props.storyboard.scenes[1].durationSec, 2);
    assert.equal(props.narration.length, 1);
    assert.equal(props.narration[0].from, 8);
    // "Hello there": 5 + 5 characters over 3.5 s -> the second word starts at 1.75 s
    assert.deepEqual(props.words, [
      { text: 'Hello', start: 8, end: 8 + 53 },
      { text: 'there', start: 8 + 53, end: 8 + 105 },
    ]);
    assert.ok(props.words.every((word) => word.end <= props.timeline.scenes[0].frames + 8));
  });
});

test('scenes audio never shortens a long scene', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base }) => {
    const sb = storyboard();
    sb.scenes[0].durationSec = 10;
    const created = await (await post(base, { storyboard: sb, assets: { 'nar-0': wavAsset }, audio: { mode: 'scenes', lines: { 0: 'nar-0' } } })).json();
    assert.equal((await waitFor(base, created.jobId)).state, 'done');
    assert.equal(calls.render.inputProps.storyboard.scenes[0].durationSec, 10);
  });
});

test('scenes audio rejects a non-audio asset, a missing scene and bad lines', async () => {
  await withServer(fakeImpls(), async ({ base }) => {
    const image = { kind: 'image', mime: 'image/png', base64: Buffer.alloc(64).toString('base64') };
    const bad = [
      { assets: { pic: image }, audio: { mode: 'scenes', lines: { 0: 'pic' } } },
      { assets: { 'nar-9': wavAsset }, audio: { mode: 'scenes', lines: { 9: 'nar-9' } } },
      { assets: { 'nar-0': wavAsset }, audio: { mode: 'scenes', lines: { 0: 'ghost' } } },
      { assets: { 'nar-0': wavAsset }, audio: { mode: 'scenes' } },
    ];
    for (const extra of bad) {
      const res = await post(base, { storyboard: storyboard(), ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra.audio));
      assert.equal((await res.json()).error, 'invalid_input');
    }
  });
});

test('narration longer than the limit fails with narration_too_long', async () => {
  const impls = { ...fakeImpls(), probeImpl: async () => 40 };
  await withServer(impls, async ({ base }) => {
    const created = await (await post(base, { storyboard: storyboard(), audio: { mode: 'tts' }, maxDurationSec: 30 })).json();
    const job = await waitFor(base, created.jobId);
    assert.equal(job.state, 'failed');
    assert.equal(job.error, 'narration_too_long');
  });
});

test('a TTS failure keeps rendering and returns a warning', async () => {
  const impls = { ...fakeImpls(), ttsImpl: async () => { throw new Error('edge down'); } };
  await withServer(impls, async ({ base }) => {
    const created = await (await post(base, { storyboard: storyboard(), audio: { mode: 'tts' } })).json();
    const job = await waitFor(base, created.jobId);
    assert.equal(job.state, 'done');
    assert.match(job.warnings.join(), /tts_failed: edge down/);
  });
});

test('cancel stops a running render through its cancel signal, and drops a queued job', async () => {
  let rendering;
  const started = new Promise((resolve) => {
    rendering = resolve;
  });
  const impls = {
    ...fakeImpls(),
    renderImpl: (opts) =>
      new Promise((_, reject) => {
        rendering();
        opts.cancelSignal((() => reject(new Error('renderMedia() got cancelled'))));
      }),
  };
  await withServer(impls, async ({ base }) => {
    const a = await (await post(base, { storyboard: storyboard() })).json();
    const b = await (await post(base, { storyboard: storyboard() })).json();
    assert.equal(b.state, 'queued');
    assert.equal(b.position, 1);
    await started;
    const cancelledQueued = await (await fetch(`${base}/jobs/${b.jobId}`, { method: 'DELETE', headers: auth })).json();
    assert.equal(cancelledQueued.state, 'cancelled');
    const res = await (await fetch(`${base}/jobs/${a.jobId}`, { method: 'DELETE', headers: auth })).json();
    assert.equal(res.cancelled, true);
    const job = await waitFor(base, a.jobId);
    assert.equal(job.state, 'cancelled');
    assert.equal(job.error, 'cancelled');
    assert.equal((await fetch(`${base}/jobs/${a.jobId}/video`, { headers: auth })).status, 409);
  });
});

test('a stage that never settles times out and frees the slot', async () => {
  const impls = { ...fakeImpls(), selectImpl: () => new Promise(() => {}) };
  await withServer({ ...impls, jobTimeoutMs: 40, jobGraceMs: 20 }, async ({ base }) => {
    const a = await (await post(base, { storyboard: storyboard() })).json();
    const job = await waitFor(base, a.jobId);
    assert.equal(job.state, 'failed');
    assert.equal(job.error, 'timeout');
    assert.match(job.message, /at stage select/);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.active, 0);
  });
});

test('a full queue answers 429 busy', async () => {
  const impls = { ...fakeImpls(), renderImpl: () => new Promise(() => {}) };
  await withServer({ ...impls, maxQueue: 1, jobTimeoutMs: 60_000 }, async ({ base, server }) => {
    await post(base, { storyboard: storyboard() });
    await post(base, { storyboard: storyboard() });
    const third = await post(base, { storyboard: storyboard() });
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, 'busy');
    for (const job of server.jobs.values()) {
      await fetch(`${base}/jobs/${job.id}`, { method: 'DELETE', headers: auth });
    }
  });
});

test('stills return one key frame per scene', async () => {
  await withServer(fakeImpls(), async ({ base }) => {
    const res = await (await post(base, { storyboard: storyboard(), stills: 6 }, '/stills')).json();
    assert.equal(res.ok, true);
    assert.equal(res.stills.length, 2);
    assert.deepEqual(res.stills.map((s) => s.frame), [36, 96]);
    const exact = await (await post(base, { storyboard: storyboard(), frames: [67, 5000, -1, 3] }, '/stills')).json();
    assert.deepEqual(exact.stills.map((s) => s.frame), [67, 3], 'exact frames inside the clip only');
  });
});

test('assets are written, served over the worker HTTP route and removed after the job', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base, server }) => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
    const body = {
      storyboard: { title: 'p', scenes: [{ type: 'image', durationSec: 2, image: 'pic' }] },
      assets: { pic: { kind: 'image', mime: 'image/png', base64: png.toString('base64'), credit: 'Photo by A on Pexels' } },
    };
    const created = await (await post(base, body)).json();
    await waitFor(base, created.jobId);
    const ref = calls.render.inputProps.assets.pic;
    assert.match(ref.src, /^http:\/\/127\.0\.0\.1:\d+\/media\/[0-9a-f-]{36}\/pic\.png$/);
    assert.equal(ref.credit, 'Photo by A on Pexels');
    assert.equal(server.media.size, 0, 'media entries are dropped when the job ends');
    const bad = await post(base, { ...body, assets: { pic: { kind: 'image', mime: 'text/html', base64: 'x'.repeat(20) } } });
    assert.equal(bad.status, 400);
  });
});

test('/media serves only registered files; unknown ids and traversal give 404', async () => {
  await withServer(fakeImpls(), async ({ base, server }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-test-'));
    const file = path.join(dir, 'a.wav');
    await fs.writeFile(file, 'RIFFdata');
    server.media.set('11111111-1111-1111-1111-111111111111', { file, name: 'a.wav' });
    const ok = await fetch(`${base}/media/11111111-1111-1111-1111-111111111111/a.wav`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'audio/wav');
    for (const p of [
      '/media/22222222-2222-2222-2222-222222222222/a.wav',
      '/media/11111111-1111-1111-1111-111111111111/other.wav',
      '/media/11111111-1111-1111-1111-111111111111/..%2F..%2Fetc%2Fpasswd',
    ]) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
});

test('a failed bundle is not cached and concurrent callers share one build', async () => {
  const diag = createDiagnostics({ print: false });
  let calls = 0;
  const manager = createBundleManager({
    diag,
    bundleImpl: async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      if (calls === 1) {
        throw new Error('webpack boom');
      }
      return 'http://bundle';
    },
  });
  const [a, b] = await Promise.allSettled([manager.get(), manager.get()]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'rejected');
  assert.equal(calls, 1);
  assert.equal(await manager.get(), 'http://bundle');
  assert.equal(manager.snapshot().attempts, 2);
  const never = createBundleManager({ diag, bundleImpl: async () => { throw new Error('x'); } });
  assert.equal(await never.warm([1, 1]), false);
});

test('a hung preview times out, is cancelled and frees the preview slot', async () => {
  let calls = 0;
  let cancelled = false;
  const impls = {
    ...fakeImpls(),
    stillImpl: (opts) => {
      calls += 1;
      if (calls === 1) {
        opts.cancelSignal?.(() => {
          cancelled = true;
        });
        return new Promise(() => {});
      }
      return Promise.resolve({ buffer: Buffer.from('jpeg') });
    },
  };
  await withServer({ ...impls, stillsTimeoutMs: 60 }, async ({ base }) => {
    const hung = await post(base, { storyboard: storyboard(), timeoutMs: 120_000 }, '/stills');
    assert.equal(hung.status, 504);
    assert.equal((await hung.json()).error, 'timeout');
    assert.equal(cancelled, true);
    const next = await post(base, { storyboard: storyboard() }, '/stills');
    assert.equal(next.status, 200, 'the next preview is not refused as busy');
  });
});

test('a repeated idempotency key returns the job the worker already has', async () => {
  const impls = { ...fakeImpls(), renderImpl: () => new Promise(() => {}) };
  await withServer({ ...impls, jobTimeoutMs: 60_000 }, async ({ base, server }) => {
    const headers = { ...json, 'Idempotency-Key': '65c000000000000000000001' };
    const send = () => fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({ storyboard: storyboard() }) });
    const first = await send();
    const second = await send();
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).jobId, (await first.json()).jobId);
    assert.equal(server.jobs.size, 1);
    for (const job of server.jobs.values()) {
      await fetch(`${base}/jobs/${job.id}`, { method: 'DELETE', headers: auth });
    }
  });
});

test('a queued job keeps its assets on disk, not in memory', async () => {
  const impls = { ...fakeImpls(), renderImpl: () => new Promise(() => {}) };
  await withServer({ ...impls, jobTimeoutMs: 60_000 }, async ({ base, server }) => {
    await post(base, { storyboard: storyboard() });
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
    const body = {
      storyboard: { title: 'p', scenes: [{ type: 'image', durationSec: 2, image: 'pic' }] },
      assets: { pic: { kind: 'image', mime: 'image/png', base64: png.toString('base64') } },
    };
    const queued = await (await post(base, body)).json();
    assert.equal(queued.state, 'queued');
    const job = server.jobs.get(queued.jobId);
    assert.deepEqual(await fs.readFile(path.join(job.workDir, 'pic.png')), png);
    assert.equal(job.input.assets, undefined, 'the queued input holds no base64');
    for (const item of server.jobs.values()) {
      await fetch(`${base}/jobs/${item.id}`, { method: 'DELETE', headers: auth });
    }
  });
});

test('an oversized body answers 413 instead of a reset connection', async () => {
  await withServer({ ...fakeImpls(), bodyLimit: 1024 }, async ({ base }) => {
    const res = await post(base, { storyboard: storyboard(), pad: 'x'.repeat(4096) });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'too_large');
  });
});

test('stale clip temp dirs are removed at startup, other dirs are kept', async () => {
  const { sweepTempDirs } = await import('../src/server.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-test-'));
  await fs.mkdir(path.join(root, 'hivegpt-clip-abc123'));
  await fs.writeFile(path.join(root, 'hivegpt-clip-abc123', 'out.mp4'), 'x');
  await fs.mkdir(path.join(root, 'other-dir'));
  assert.equal(await sweepTempDirs(root), 1);
  assert.deepEqual(await fs.readdir(root), ['other-dir']);
  await fs.rm(root, { recursive: true, force: true });
});
