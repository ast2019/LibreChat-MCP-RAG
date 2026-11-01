import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionManager } from '../src/sessions.mjs';

const LIMITS = {
  ownerLimit: 1,
  serverLimit: 2,
  ram: 85,
  cpu: 90,
  idleMs: 180_000,
  maxMs: 1_200_000,
};
const calm = { current: () => ({ ram: { percent: 40 }, cpu: 20, container: null }) };

function setup({ monitor = calm, openBrowser } = {}) {
  let clock = 1_000;
  let ids = 0;
  const closed = [];
  const hooks = [];
  const manager = createSessionManager({
    monitor,
    now: () => clock,
    newId: () => `s${++ids}`,
    log: { warn: () => {} },
    openBrowser:
      openBrowser ??
      (async (callbacks) => {
        hooks.push(callbacks);
        return { page: () => null, blocked: () => [], close: async () => closed.push(ids) };
      }),
  });
  return { manager, closed, hooks, advance: (ms) => (clock += ms) };
}

test('one browser per user and a server-wide limit, counting launches in progress', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { manager } = setup({
    openBrowser: async () => {
      await gate;
      return { page: () => null, blocked: () => [], close: async () => {} };
    },
  });
  const first = manager.create({ ...LIMITS, owner: 'u1' });
  await assert.rejects(manager.create({ ...LIMITS, owner: 'u1' }), { code: 'user_limit' });
  const second = manager.create({ ...LIMITS, owner: 'u2' });
  await assert.rejects(manager.create({ ...LIMITS, owner: 'u3' }), { code: 'server_full' });
  release();
  await Promise.all([first, second]);
  assert.equal(manager.count(), 2);
});

test('a busy server refuses with the reason', async () => {
  const { manager } = setup({
    monitor: { current: () => ({ ram: { percent: 91 }, cpu: 5, container: null }) },
  });
  await assert.rejects(manager.create({ ...LIMITS, owner: 'u1' }), {
    code: 'capacity',
    detail: 'ram',
  });
  const cpuBound = setup({
    monitor: { current: () => ({ ram: { percent: 10 }, cpu: 95, container: null }) },
  });
  await assert.rejects(cpuBound.manager.create({ ...LIMITS, owner: 'u1' }), {
    code: 'capacity',
    detail: 'cpu',
  });
});

test('idle and overlong browsers close themselves and are logged with the reason', async () => {
  const { manager, advance } = setup();
  const idle = await manager.create({ ...LIMITS, owner: 'u1' });
  const busy = await manager.create({ ...LIMITS, owner: 'u2' });
  advance(170_000);
  await manager.use(busy.id, async () => 'step');
  advance(20_000);
  await manager.sweep();
  assert.deepEqual(
    manager.list().map((session) => session.id),
    [busy.id],
  );
  advance(1_100_000);
  await manager.sweep();
  assert.equal(manager.count(), 0);
  const ended = manager.events(0).events.map((event) => [event.session.id, event.session.reason]);
  assert.deepEqual(ended, [
    [idle.id, 'idle'],
    [busy.id, 'timeout'],
  ]);
  assert.equal(manager.events(1).events.length, 1);
});

test('a crashed browser is recorded and frees its place', async () => {
  const { manager, hooks } = setup();
  const session = await manager.create({ ...LIMITS, owner: 'u1' });
  hooks[0].onDomain('www.digikala.com');
  hooks[0].onClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.count(), 0);
  const [event] = manager.events(0).events;
  assert.equal(event.session.reason, 'crashed');
  assert.deepEqual(event.session.domains, ['www.digikala.com']);
  await assert.rejects(
    manager.use(session.id, async () => 1),
    { code: 'not_found' },
  );
  assert.equal(await manager.close(session.id), null);
});

test('a failed launch frees the reserved place', async () => {
  const { manager } = setup({
    openBrowser: async () => {
      throw new Error("Executable doesn't exist\nmore");
    },
  });
  await assert.rejects(manager.create({ ...LIMITS, owner: 'u1' }), {
    code: 'launch_failed',
    message: "Executable doesn't exist",
  });
  assert.equal(manager.count(), 0);
});
