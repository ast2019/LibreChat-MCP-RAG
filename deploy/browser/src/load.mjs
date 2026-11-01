import fs from 'node:fs/promises';

const SAMPLE_MS = 5_000;
const CPU_WINDOW_MS = 60_000;
const HISTORY_MS = 60_000;
const HISTORY_POINTS = 24 * 60;

/** Percentage with one decimal, clamped to 0..100. */
const percent = (part, whole) =>
  whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 1000) / 10)) : 0;

/** Host memory in use, from `MemTotal` and `MemAvailable` (bytes). */
export function parseMeminfo(text) {
  const read = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = read('MemTotal');
  const available = read('MemAvailable');
  if (total == null || available == null) {
    return null;
  }
  return { total, used: total - available, percent: percent(total - available, total) };
}

/** The aggregate `cpu` line of /proc/stat as busy and total jiffies. */
export function parseCpuTimes(text) {
  const line = text.split('\n').find((row) => row.startsWith('cpu '));
  if (!line) {
    return null;
  }
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  /* user nice system idle iowait irq softirq steal; guest time is already inside user. */
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] =
    values;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { busy: total - idle - iowait, total };
}

/** One counter of a cgroup `memory.stat` file, or 0. */
const readStat = (text, name) => Number(new RegExp(`^${name} (\\d+)$`, 'm').exec(text)?.[1] ?? 0);

/**
 * This container's memory against its limit (cgroup v2, then v1); null without a limit. Like
 * `docker stats`, the inactive file cache is left out: the kernel reclaims it before refusing.
 */
export async function readContainerMemory(readFile = (path) => fs.readFile(path, 'utf8')) {
  const attempt = async (usagePath, limitPath, statPath, inactiveName) => {
    try {
      const [usage, limit] = await Promise.all([readFile(usagePath), readFile(limitPath)]);
      const stat = await readFile(statPath).catch(() => '');
      const max = Number(limit.trim());
      const used = Number(usage.trim()) - readStat(stat, inactiveName);
      /* "max" (v2) or a near-2^63 value (v1) means no limit. */
      if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0 || max > 2 ** 60) {
        return null;
      }
      const working = Math.max(0, used);
      return { used: working, limit: max, percent: percent(working, max) };
    } catch {
      return undefined;
    }
  };
  const v2 = await attempt(
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory.stat',
    'inactive_file',
  );
  if (v2 !== undefined) {
    return v2;
  }
  return (
    (await attempt(
      '/sys/fs/cgroup/memory/memory.usage_in_bytes',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes',
      '/sys/fs/cgroup/memory/memory.stat',
      'total_inactive_file',
    )) ?? null
  );
}

/**
 * Samples the server every few seconds: host RAM, host CPU averaged over the last minute, and
 * this container's memory against its limit. Keeps one point a minute for the last 24 hours.
 */
export function createLoadMonitor({
  readFile = (path) => fs.readFile(path, 'utf8'),
  now = Date.now,
  countSessions = () => 0,
  sampleMs = SAMPLE_MS,
} = {}) {
  const cpuSamples = [];
  const history = [];
  let current = { at: now(), ram: null, cpu: null, container: null };
  /* The first sample starts the history, so the chart is not empty for a minute. */
  let lastPoint = -Infinity;
  let timer;

  const sample = async () => {
    const at = now();
    const [meminfo, stat, container] = await Promise.all([
      readFile('/proc/meminfo').then(parseMeminfo, () => null),
      readFile('/proc/stat').then(parseCpuTimes, () => null),
      readContainerMemory(readFile),
    ]);
    if (stat) {
      cpuSamples.push({ at, ...stat });
      while (cpuSamples.length > 2 && at - cpuSamples[1].at >= CPU_WINDOW_MS) {
        cpuSamples.shift();
      }
    }
    const first = cpuSamples[0];
    const last = cpuSamples[cpuSamples.length - 1];
    const cpu =
      first && last && last.total > first.total
        ? percent(last.busy - first.busy, last.total - first.total)
        : null;
    current = { at, ram: meminfo, cpu, container };
    if (at - lastPoint >= HISTORY_MS) {
      lastPoint = at;
      history.push({
        at,
        ram: meminfo?.percent ?? null,
        cpu,
        container: container?.percent ?? null,
        sessions: countSessions(),
      });
      if (history.length > HISTORY_POINTS) {
        history.shift();
      }
    }
    return current;
  };

  return {
    sample,
    start() {
      if (!timer) {
        void sample();
        timer = setInterval(() => void sample(), sampleMs);
        timer.unref();
      }
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    /** The latest reading; `cpu` is null until two samples a few seconds apart exist. */
    current: () => current,
    history: () => history.slice(),
  };
}

/**
 * Why the server cannot take another browser, or null when it can. RAM counts the host and,
 * when the container has a memory limit, the container too.
 */
export function capacityProblem(reading, { ram, cpu }) {
  if (reading.ram && reading.ram.percent >= ram) {
    return 'ram';
  }
  if (reading.container && reading.container.percent >= ram) {
    return 'ram';
  }
  if (reading.cpu != null && reading.cpu >= cpu) {
    return 'cpu';
  }
  return null;
}
