import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createBrowserLauncher } from '../src/browser.mjs';
import { redactSnapshot } from '../src/page.mjs';
import { createServer } from '../src/server.mjs';
import { createSessionManager } from '../src/sessions.mjs';

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
const skip = !executablePath && 'no Chromium';
const TOKEN = 'live-token-0123456789abcdef0123456789';
const LOGIN = `<!doctype html><html lang="fa" dir="rtl"><head><title>ورود</title></head><body>
<form onsubmit="event.preventDefault(); document.title = 'خوش آمدید ' + document.getElementById('u').value">
<label>ایمیل <input id="u" style="position:absolute;top:20px;left:20px;width:300px;height:30px"></label>
<label>رمز <input id="p" type="password" style="position:absolute;top:80px;left:20px;width:300px;height:30px"></label>
<button style="position:absolute;top:140px;left:20px">ورود</button></form></body></html>`;

let target;
let targetPort;
let api;
let base;
let manager;

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

async function call(method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

/** Reads the frames stream until `count` events of the wanted kinds arrived. */
async function readEvents(route, wanted, count) {
  const controller = new AbortController();
  const response = await fetch(`${base}${route}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (name && wanted.includes(name)) {
          events.push({ name, data: JSON.parse(data) });
        }
      }
      if (events.length >= count) {
        break;
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return events;
}

before(async () => {
  if (!executablePath) {
    return;
  }
  target = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LOGIN);
  });
  targetPort = await listen(target);
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

test('secret field values never reach the snapshot', () => {
  const snapshot = [
    '- textbox "ایمیل" [ref=e4]: sara@example.com',
    '- textbox "رمز" [active] [ref=e6]: SuperSecret123',
    '- textbox "CVV2" [ref=e7]: "12:34"',
    '- text: SuperSecret123 appears here as text',
  ].join('\n');
  const redacted = redactSnapshot(snapshot, new Set(['SuperSecret123', '12:34']));
  assert.match(redacted, /sara@example\.com/);
  assert.doesNotMatch(redacted, /textbox "رمز" \[active\] \[ref=e6\]: SuperSecret123/);
  assert.match(redacted, /textbox "رمز" \[active\] \[ref=e6\]: ••••••/);
  assert.match(redacted, /textbox "CVV2" \[ref=e7\]: ••••••/);
});

test(
  'the user signs in in the live view while the model waits, and the model never reads the password',
  { skip },
  async () => {
    const created = await call('POST', '/sessions', { owner: 'u1', context: 'chat-1' });
    const id = created.body.session.id;
    assert.equal(created.body.session.control, 'model');
    assert.deepEqual(
      (await call('GET', '/sessions?owner=u1&context=chat-1')).body.sessions.map((s) => s.id),
      [id],
    );
    assert.deepEqual((await call('GET', '/sessions?owner=u1&context=chat-2')).body.sessions, []);

    const opened = await call('POST', `/sessions/${id}/open`, {
      url: `http://127.0.0.1:${targetPort}/`,
      snapshot: true,
    });
    assert.equal(opened.body.title, 'ورود');
    assert.match(opened.body.snapshot, /textbox "رمز" \[ref=e\d+\]/);

    /* Only the user may type into the live view, and only after the model hands it over. */
    assert.equal(
      (await call('POST', `/sessions/${id}/input`, { type: 'type', text: 'x' })).body.error,
      'model_control',
    );
    const handed = await call('POST', `/sessions/${id}/control`, {
      to: 'user',
      handoff: { reason: 'login', message: 'وارد حساب شوید' },
    });
    assert.deepEqual(handed.body.session.handoff, { reason: 'login', message: 'وارد حساب شوید' });
    assert.equal((await call('POST', `/sessions/${id}/read`, {})).body.error, 'user_control');

    const email = await call('POST', `/sessions/${id}/input`, { type: 'click', x: 100, y: 35 });
    assert.equal(email.body.focus, 'text');
    await call('POST', `/sessions/${id}/input`, { type: 'type', text: 'sara@example.com' });
    const password = await call('POST', `/sessions/${id}/input`, { type: 'click', x: 100, y: 95 });
    assert.equal(password.body.focus, 'password');
    await call('POST', `/sessions/${id}/input`, { type: 'type', text: 'SuperSecret123' });
    const submitted = await call('POST', `/sessions/${id}/input`, { type: 'key', key: 'Enter' });
    assert.equal(submitted.body.title, 'خوش آمدید sara@example.com');
    assert.equal(
      (await call('POST', `/sessions/${id}/input`, { type: 'key', key: 'F12' })).body.error,
      'invalid_input',
    );

    const back = await call('POST', `/sessions/${id}/control`, { to: 'model' });
    assert.equal(back.body.session.handoff, null);
    const read = await call('POST', `/sessions/${id}/read`, {});
    assert.equal(read.status, 200);
    assert.doesNotMatch(read.body.snapshot, /SuperSecret123/);
    assert.match(read.body.snapshot, /textbox "رمز" (\[active\] )?\[ref=e\d+\]: ••••••/);
    assert.match(read.body.snapshot, /sara@example\.com/);
    await call('DELETE', `/sessions/${id}`);
  },
);

test('the frames stream sends the state and JPEG frames of the page', { skip }, async () => {
  const { body } = await call('POST', '/sessions', { owner: 'u2', context: 'chat-9' });
  const id = body.session.id;
  await call('POST', `/sessions/${id}/open`, { url: `http://127.0.0.1:${targetPort}/` });
  const events = await readEvents(`/sessions/${id}/frames?fps=5&quality=40`, ['state', 'frame'], 2);
  const state = events.find((event) => event.name === 'state');
  const frame = events.find((event) => event.name === 'frame');
  assert.deepEqual(state.data, {
    control: 'model',
    handoff: null,
    url: `http://127.0.0.1:${targetPort}/`,
    title: 'ورود',
  });
  assert.ok(
    Buffer.from(frame.data.data, 'base64')
      .subarray(0, 2)
      .equals(Buffer.from([0xff, 0xd8])),
  );
  assert.deepEqual([frame.data.width, frame.data.height], [1280, 800]);
  assert.equal((await call('GET', '/sessions/nope/frames')).status, 404);
  await call('DELETE', `/sessions/${id}?reason=replaced`);
  const { events: ended } = (await call('GET', '/events?after=0')).body;
  assert.equal(ended.at(-1).session.reason, 'replaced');
});
