const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_ENTRIES = 500;
const MAX_JOBS = 15;
const MAX_STRING = 300;

const BASE64_RUN = /[A-Za-z0-9+/=]{200,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_KEY = /token|secret|password|authorization|apikey|api_key|base64|text|body/i;

/** Cut long strings, mask base64 blobs and bearer tokens. */
export const cleanString = (value) => {
  let text = String(value).replace(BEARER, 'Bearer [redacted]').replace(BASE64_RUN, '[blob]');
  if (text.length > MAX_STRING) {
    text = `${text.slice(0, MAX_STRING)}...(+${text.length - MAX_STRING})`;
  }
  return text;
};

const clean = (value, depth = 0) => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return cleanString(value);
  }
  if (value instanceof Error) {
    return cleanString(value.message);
  }
  if (depth >= 3) {
    return '[deep]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => clean(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      out[key] = SECRET_KEY.test(key) && typeof item === 'string' ? '[redacted]' : clean(item, depth + 1);
    }
    return out;
  }
  return cleanString(value);
};

const line = (entry) => {
  const parts = [`[remotion]`, entry.level, entry.event];
  if (entry.jobId) {
    parts.push(`job=${entry.jobId}`);
  }
  for (const [key, value] of Object.entries(entry.data ?? {})) {
    const printed = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${printed.replace(/\s+/g, ' ')}`);
  }
  return parts.join(' ');
};

/**
 * In-memory diagnostics: ring buffer of structured log entries, counters and recent job
 * summaries. `print: false` silences stdout (tests).
 */
export function createDiagnostics({ print = true } = {}) {
  const entries = [];
  const jobs = [];
  const counters = { rendersOk: 0, rendersFailed: 0, lastError: null };
  let nextId = 1;

  const log = (level, event, data = {}, jobId) => {
    const entry = {
      id: nextId++,
      at: new Date().toISOString(),
      level: LEVELS[level] ? level : 'info',
      event,
      ...(jobId ? { jobId } : {}),
      data: clean(data),
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
    }
    if (print && entry.level !== 'debug') {
      const out = line(entry);
      if (LEVELS[entry.level] >= LEVELS.error) {
        console.error(out);
      } else if (entry.level === 'warn') {
        console.warn(out);
      } else {
        console.log(out);
      }
    }
    return entry;
  };

  const getLogs = ({ limit = 200, minLevel = 'debug', afterId = 0 } = {}) => {
    const min = LEVELS[minLevel] ?? 0;
    const cap = Math.min(MAX_ENTRIES, Math.max(1, Number(limit) || 200));
    const picked = entries.filter(
      (entry) => entry.id > (Number(afterId) || 0) && LEVELS[entry.level] >= min,
    );
    return picked.slice(-cap);
  };

  const recordJob = (summary) => {
    const clipped = clean(summary);
    jobs.push(clipped);
    if (jobs.length > MAX_JOBS) {
      jobs.shift();
    }
    if (clipped.ok) {
      counters.rendersOk += 1;
    } else {
      counters.rendersFailed += 1;
      counters.lastError = {
        at: new Date().toISOString(),
        jobId: clipped.jobId,
        stage: clipped.stage,
        code: clipped.error,
        message: clipped.message,
      };
    }
  };

  return {
    log,
    debug: (event, data, jobId) => log('debug', event, data, jobId),
    info: (event, data, jobId) => log('info', event, data, jobId),
    warn: (event, data, jobId) => log('warn', event, data, jobId),
    error: (event, data, jobId) => log('error', event, data, jobId),
    getLogs,
    lastId: () => nextId - 1,
    recordJob,
    counters: () => ({ ...counters }),
    lastJobs: () => jobs.slice().reverse(),
  };
}
