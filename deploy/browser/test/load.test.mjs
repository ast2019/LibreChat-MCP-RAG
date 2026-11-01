import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capacityProblem,
  createLoadMonitor,
  parseCpuTimes,
  parseMeminfo,
  readContainerMemory,
} from '../src/load.mjs';

const meminfo = (totalKb, availableKb) =>
  `MemTotal:       ${totalKb} kB\nMemFree:          1000 kB\nMemAvailable:   ${availableKb} kB\n`;

test('host memory in use comes from MemTotal and MemAvailable', () => {
  const reading = parseMeminfo(meminfo(1_000_000, 250_000));
  assert.equal(reading.percent, 75);
  assert.equal(reading.total, 1_000_000 * 1024);
  assert.equal(parseMeminfo('garbage'), null);
});

test('CPU times leave out idle and iowait', () => {
  const times = parseCpuTimes('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4\n');
  assert.deepEqual(times, { busy: 150, total: 1000 });
});

test('container memory needs a real limit', async () => {
  const files = (map) => async (path) => {
    if (!(path in map)) {
      throw new Error('ENOENT');
    }
    return map[path];
  };
  const limited = await readContainerMemory(
    files({
      '/sys/fs/cgroup/memory.current': '1073741824\n',
      '/sys/fs/cgroup/memory.max': '4294967296\n',
    }),
  );
  assert.equal(limited.percent, 25);
  /* Reclaimable file cache does not count, as in `docker stats`. */
  const cached = await readContainerMemory(
    files({
      '/sys/fs/cgroup/memory.current': '2147483648\n',
      '/sys/fs/cgroup/memory.max': '4294967296\n',
      '/sys/fs/cgroup/memory.stat': 'anon 1000\ninactive_file 1073741824\nactive_file 5\n',
    }),
  );
  assert.equal(cached.percent, 25);
  assert.equal(cached.used, 1073741824);
  const unlimited = await readContainerMemory(
    files({
      '/sys/fs/cgroup/memory.current': '1073741824\n',
      '/sys/fs/cgroup/memory.max': 'max\n',
    }),
  );
  assert.equal(unlimited, null);
  assert.equal(await readContainerMemory(files({})), null);
});

test('the monitor averages CPU over the last minute and keeps a point a minute', async () => {
  let clock = 0;
  let busy = 0;
  let total = 0;
  const monitor = createLoadMonitor({
    now: () => clock,
    countSessions: () => 2,
    readFile: async (path) => {
      if (path === '/proc/meminfo') {
        return meminfo(1_000_000, 100_000);
      }
      if (path === '/proc/stat') {
        return `cpu  ${busy} 0 0 ${total - busy} 0 0 0 0\n`;
      }
      throw new Error('ENOENT');
    },
  });
  await monitor.sample();
  assert.equal(monitor.current().cpu, null);
  for (let step = 1; step <= 24; step++) {
    clock += 5_000;
    total += 1_000;
    busy += step <= 12 ? 950 : 500;
    await monitor.sample();
  }
  /* Only the last minute counts: the busy first minute has left the window. */
  assert.equal(monitor.current().cpu, 50);
  assert.equal(monitor.current().ram.percent, 90);
  const history = monitor.history();
  assert.equal(history.length, 3);
  assert.deepEqual(Object.keys(history[0]).sort(), ['at', 'container', 'cpu', 'ram', 'sessions']);
  assert.equal(history[2].sessions, 2);
});

test('capacity is refused at the RAM or CPU threshold', () => {
  const limits = { ram: 85, cpu: 90 };
  assert.equal(
    capacityProblem({ ram: { percent: 84.9 }, cpu: 89.9, container: null }, limits),
    null,
  );
  assert.equal(capacityProblem({ ram: { percent: 85 }, cpu: 10, container: null }, limits), 'ram');
  assert.equal(
    capacityProblem({ ram: { percent: 50 }, cpu: 10, container: { percent: 92 } }, limits),
    'ram',
  );
  assert.equal(capacityProblem({ ram: { percent: 50 }, cpu: 90, container: null }, limits), 'cpu');
  /* No CPU reading yet (the first seconds after start) does not block. */
  assert.equal(capacityProblem({ ram: { percent: 50 }, cpu: null, container: null }, limits), null);
});
