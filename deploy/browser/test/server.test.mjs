import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createBrowserLauncher } from '../src/browser.mjs';
import { createServer } from '../src/server.mjs';
import { createSessionManager } from '../src/sessions.mjs';

/* Real Chromium: BROWSER_EXECUTABLE, or Playwright's headless shell when it is installed. */
function findChromium() {
  if (process.env.BROWSER_EXECUTABLE) {
    return process.env.BROWSER_EXECUTABLE;
  }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dir = fs.existsSync(cache)
    ? fs.readdirSync(cache).find((name) => name.startsWith('chromium_headless_shell-'))
    : undefined;
  const binary =
    dir && path.join(cache, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  return binary && fs.existsSync(binary) ? binary : null;
}

const executablePath = findChromium();
const TOKEN = 'test-token-0123456789abcdef0123456789';
const PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><title>فروشگاه آزمایشی</title></head>
<body><h1>فروشگاه</h1><label>جستجو <input id="q"></label>
<button onclick="document.title = 'نتیجه: ' + document.getElementById('q').value">جستجو کن</button>
<img src="http://10.255.255.1/tracker.png" alt=""></body></html>`;

let target;
let targetPort;
let api;
let base;
let manager;

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

async function call(method, route, body, token = TOKEN) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  if (!executablePath) {
    return;
  }
  target = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  targetPort = await listen(target);
  /* The local test page stands in for a public site: 127.0.0.1 on its port, nothing else. */
  const policy = { isAllowed: (address) => address === '127.0.0.1', ports: [targetPort] };
  const monitor = {
    current: () => ({ ram: { percent: 30 }, cpu: 10, container: null }),
    history: () => [],
  };
  manager = createSessionManager({
    monitor,
    openBrowser: createBrowserLauncher({ executablePath, proxyOptions: policy }),
  });
  api = createServer({ manager, monitor, token: TOKEN, policy });
  base = `http://127.0.0.1:${await listen(api)}`;
});

after(async () => {
  await manager?.shutdown();
  api?.close();
  target?.close();
});

test(
  'a browser session opens, reads, acts and closes',
  { skip: !executablePath && 'no Chromium' },
  async () => {
    assert.equal((await call('GET', '/status', undefined, 'wrong')).status, 401);

    const created = await call('POST', '/sessions', {
      owner: 'user-1',
      ownerLimit: 1,
      serverLimit: 10,
    });
    assert.equal(created.status, 201);
    const id = created.body.session.id;
    assert.equal((await call('POST', '/sessions', { owner: 'user-1' })).body.error, 'user_limit');

    const opened = await call('POST', `/sessions/${id}/open`, {
      url: `http://127.0.0.1:${targetPort}/`,
    });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.title, 'فروشگاه آزمایشی');

    const read = await call('POST', `/sessions/${id}/read`, { screenshot: true });
    assert.match(read.body.snapshot, /textbox "جستجو" \[ref=e\d+\]/);
    assert.ok(read.body.screenshot.startsWith('/9j/'), 'a JPEG screenshot');
    assert.ok(
      read.body.blocked.some((event) => event.host === '10.255.255.1'),
      'the private image was refused',
    );

    const ref = (role) =>
      read.body.snapshot
        .split('\n')
        .find((line) => line.includes(role))
        .match(/\[ref=(e\d+)\]/)[1];
    await call('POST', `/sessions/${id}/act`, {
      action: 'type',
      ref: ref('textbox'),
      text: 'گوشی',
    });
    const clicked = await call('POST', `/sessions/${id}/act`, {
      action: 'click',
      ref: ref('button'),
    });
    assert.equal(clicked.body.title, 'نتیجه: گوشی');
    assert.equal(
      (await call('POST', `/sessions/${id}/act`, { action: 'click', ref: 'nope' })).body.error,
      'invalid_action',
    );

    const otherPort = await call('POST', `/sessions/${id}/open`, {
      url: `http://127.0.0.1:${targetPort + 1}/`,
    });
    assert.equal(otherPort.body.error, 'blocked_address');
    const fileUrl = await call('POST', `/sessions/${id}/open`, { url: 'file:///etc/passwd' });
    assert.equal(fileUrl.body.error, 'invalid_url');

    const status = await call('GET', '/status');
    assert.deepEqual(
      status.body.sessions.map((session) => session.domains),
      [['127.0.0.1']],
    );

    assert.equal((await call('DELETE', `/sessions/${id}?reason=admin`)).status, 200);
    assert.equal((await call('GET', `/sessions/${id}`)).status, 404);
    const { events } = (await call('GET', '/events?after=0')).body;
    assert.equal(events.at(-1).session.reason, 'admin');
  },
);

test(
  'the default policy refuses this host and the private networks',
  { skip: !executablePath && 'no Chromium' },
  async () => {
    const strict = createServer({
      manager,
      monitor: { current: () => ({}), history: () => [] },
      token: TOKEN,
    });
    const port = await listen(strict);
    const strictCall = (method, route, body) =>
      fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => response.json());
    const { session } = await strictCall('POST', '/sessions', { owner: 'user-2' });
    for (const url of [
      'http://127.0.0.1/',
      'http://localhost/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
    ]) {
      assert.equal(
        (await strictCall('POST', `/sessions/${session.id}/open`, { url })).error,
        'blocked_address',
        url,
      );
    }
    await manager.close(session.id);
    strict.close();
  },
);
