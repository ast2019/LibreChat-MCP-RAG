import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { createBundleManager, createServer } from '../src/server.mjs';

const TOKEN = 't'.repeat(40);
const auth = { Authorization: `Bearer ${TOKEN}` };

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

const scenes = [{ type: 'title', durationSec: 2, heading: 'Hello', body: 'World' }];

const fakeImpls = (calls = {}) => ({
  bundleImpl: async () => 'http://bundle',
  selectImpl: async (opts) => {
    calls.select = opts;
    return { id: opts.id, width: 1, height: 1, fps: 30, durationInFrames: 60, props: {} };
  },
  renderImpl: async (opts) => {
    calls.render = opts;
    opts.onProgress?.({ progress: 1, renderedFrames: 60, encodedFrames: 60 });
    await fs.writeFile(opts.outputLocation, Buffer.from('fakemp4'));
  },
  probeImpl: async () => null,
});

const withServer = async (opts, fn) => {
  const diagnostics = createDiagnostics({ print: false });
  const server = createServer({ token: TOKEN, diagnostics, ...opts });
  const port = await listen(server);
  try {
    await fn({ port, base: `http://127.0.0.1:${port}`, server, diagnostics });
  } finally {
    server.close();
  }
};

test('health is public and reports readiness; status and logs need the token', async () => {
  await withServer(fakeImpls(), async ({ base }) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.ready, false);
    assert.equal(health.bundle, 'idle');
    assert.equal(typeof health.uptimeSec, 'number');
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/logs`)).status, 401);
    const status = await fetch(`${base}/status`, { headers: auth });
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.ok(body.config && body.memory && body.counters && Array.isArray(body.lastJobs));
    const logs = await (await fetch(`${base}/logs?limit=5&level=info`, { headers: auth })).json();
    assert.equal(logs.ok, true);
    assert.ok(Array.isArray(logs.entries));
  });
});

test('render returns ids, timings and logs the stages', async () => {
  const calls = {};
  await withServer(fakeImpls(calls), async ({ base }) => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'chalkboard', scenes, durationSec: 2 }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.mime, 'video/mp4');
    assert.ok(body.jobId);
    assert.deepEqual(Object.keys(body.timings).sort(), ['bundleMs', 'renderMs', 'selectMs', 'ttsMs']);
    assert.equal(body.durationSec, 2);
    assert.equal(calls.render.concurrency, 1);
    assert.equal(calls.select.id, 'HiveGPTStyledFilm');
    const logs = await (await fetch(`${base}/logs`, { headers: auth })).json();
    const events = logs.entries.map((e) => e.event);
    for (const name of ['job.start', 'select.ok', 'render.ok']) {
      assert.ok(events.includes(name), name);
    }
    const status = await (await fetch(`${base}/status`, { headers: auth })).json();
    assert.equal(status.counters.rendersOk, 1);
    assert.equal(status.lastJobs[0].jobId, body.jobId);
  });
});

test('style film length follows the request and audio length, capped', async () => {
  const calls = {};
  await withServer({ ...fakeImpls(calls), probeImpl: async () => 9.2, ttsImpl: async (t, v, dir) => {
    const file = path.join(dir, 'tts.mp3');
    await fs.writeFile(file, 'x');
    return file;
  } }, async ({ base }) => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'chalkboard', scenes, durationSec: 2, ttsText: 'hi' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Math.abs(body.durationSec - 9.2) < 0.05);
    assert.equal(calls.render.inputProps.durationSec, body.durationSec);
    assert.match(calls.render.inputProps.audioSrc, /^http:\/\/127\.0\.0\.1:\d+\/media\/[0-9a-f-]{36}\/tts\.mp3$/);
  });
});

test('tts failure keeps rendering and returns a warning', async () => {
  await withServer({ ...fakeImpls(), ttsImpl: async () => { throw new Error('no network'); } }, async ({ base, diagnostics }) => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'brand-dark', scenes, ttsText: 'hello' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.warnings, ['tts_failed: no network']);
    assert.ok(diagnostics.getLogs({ minLevel: 'warn' }).some((e) => e.event === 'tts.fail'));
  });
});

test('failed render returns stage, detail and jobId', async () => {
  await withServer({ ...fakeImpls(), renderImpl: async () => { throw new Error('chrome crashed\nsecond line'); } }, async ({ base }) => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes }),
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'render_failed');
    assert.equal(body.stage, 'render');
    assert.equal(body.detail, 'chrome crashed');
    assert.ok(body.jobId);
  });
});

test('job timeout frees the slot with code timeout', async () => {
  await withServer({ ...fakeImpls(), jobTimeoutMs: 50, renderImpl: async (opts) => {
    await new Promise((resolve, reject) => {
      opts.cancelSignal(() => reject(new Error('cancelled')));
    });
  } }, async ({ base }) => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes }),
    });
    const body = await res.json();
    assert.equal(body.error, 'timeout');
    assert.equal(res.status, 504);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.active, 0);
  });
});

test('a failed bundle is not cached: the next request retries', async () => {
  const diag = createDiagnostics({ print: false });
  let calls = 0;
  const manager = createBundleManager({
    diag,
    bundleImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('webpack boom');
      }
      return 'http://bundle';
    },
  });
  await assert.rejects(manager.get(), /webpack boom/);
  assert.equal(manager.snapshot().state, 'failed');
  assert.match(manager.snapshot().error.message, /webpack boom/);
  assert.equal(await manager.get(), 'http://bundle');
  assert.equal(manager.snapshot().state, 'ready');
  assert.equal(manager.snapshot().attempts, 2);
  assert.equal(await manager.get(), 'http://bundle');
  assert.equal(calls, 2);
});

test('concurrent callers share one bundle build; warm retries and never throws', async () => {
  const diag = createDiagnostics({ print: false });
  let calls = 0;
  const manager = createBundleManager({
    diag,
    bundleImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (calls < 3) {
        throw new Error('flaky');
      }
      return 'ok';
    },
  });
  const [a, b] = await Promise.allSettled([manager.get(), manager.get()]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'rejected');
  assert.equal(calls, 1);
  assert.equal(await manager.warm([5, 5]), true);
  const never = createBundleManager({ diag, bundleImpl: async () => { throw new Error('x'); } });
  assert.equal(await never.warm([1, 1]), false);
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
    assert.equal(await ok.text(), 'RIFFdata');
    const paths = [
      '/media/22222222-2222-2222-2222-222222222222/a.wav',
      '/media/11111111-1111-1111-1111-111111111111/other.wav',
      '/media/11111111-1111-1111-1111-111111111111/..%2F..%2Fetc%2Fpasswd',
      '/media/..%2F..%2Fetc/passwd',
    ];
    for (const p of paths) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 404, p);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
});
