import crypto from 'node:crypto';
import { capacityProblem } from './load.mjs';

const SWEEP_MS = 5_000;
const EVENT_LIMIT = 1_000;
const DOMAIN_LIMIT = 50;
const HANDOFF_REASONS = new Set(['login', 'captcha', 'payment', 'confirm', 'other']);

/** A handoff as stored: a known reason and a short message, or null. */
function readHandoff(value) {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const reason = HANDOFF_REASONS.has(value.reason) ? value.reason : 'other';
  const message = typeof value.message === 'string' ? value.message.trim().slice(0, 300) : '';
  return message ? { reason, message } : { reason };
}

/** A refusal or failure with a stable code the api maps to the user's message. */
export class BrowserError extends Error {
  constructor(code, message = code, status = 400, detail = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Open browsers, one Chromium each, with the server-wide and per-user limits checked before a
 * launch and counted while it is in progress, so two requests at once cannot both take the last
 * place. A browser closes after `idleMs` without a step and after `maxMs` in any case; closing
 * ends the process and removes its profile, so nothing of the session is kept.
 */
export function createSessionManager({
  openBrowser,
  monitor,
  now = Date.now,
  newId = () => crypto.randomUUID(),
  sweepMs = SWEEP_MS,
  log = console,
}) {
  const sessions = new Map();
  const launching = new Map();
  const events = [];
  let seq = 0;
  let timer;

  const emit = (event) => {
    events.push({ seq: ++seq, at: now(), ...event });
    if (events.length > EVENT_LIMIT) {
      events.shift();
    }
  };

  const openCount = () =>
    [...sessions.values()].filter((session) => !session.closing).length +
    [...launching.values()].reduce((sum, count) => sum + count, 0);

  const ownerCount = (owner) =>
    [...sessions.values()].filter((session) => session.owner === owner && !session.closing).length +
    (launching.get(owner) ?? 0);

  const summary = (session) => ({
    id: session.id,
    owner: session.owner,
    context: session.context,
    control: session.control,
    handoff: session.handoff,
    url: session.url,
    title: session.title,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    idleMs: session.idleMs,
    maxMs: session.maxMs,
    domains: [...session.domains],
  });

  const find = (id) => {
    const session = sessions.get(id);
    if (!session || session.closing) {
      throw new BrowserError('not_found', 'This browser is closed', 404);
    }
    return session;
  };

  async function close(id, reason = 'closed') {
    const session = sessions.get(id);
    if (!session || session.closing) {
      return null;
    }
    session.closing = true;
    try {
      await session.handle.close();
    } catch (error) {
      log.warn?.(`[browser] closing ${id} failed: ${error?.message ?? error}`);
    }
    sessions.delete(id);
    const endedAt = now();
    const ended = {
      ...summary(session),
      endedAt,
      durationMs: endedAt - session.startedAt,
      reason,
    };
    emit({ type: 'ended', session: ended });
    return ended;
  }

  async function create({ owner, context = '', ownerLimit, serverLimit, ram, cpu, idleMs, maxMs }) {
    if (ownerCount(owner) >= ownerLimit) {
      throw new BrowserError('user_limit', 'This user has the most browsers open already', 409);
    }
    if (openCount() >= serverLimit) {
      throw new BrowserError('server_full', 'The server has the most browsers open already', 503);
    }
    const problem = capacityProblem(monitor.current(), { ram, cpu });
    if (problem) {
      throw new BrowserError('capacity', `The server is above its ${problem} limit`, 503, problem);
    }
    launching.set(owner, (launching.get(owner) ?? 0) + 1);
    const id = newId();
    let handle;
    try {
      handle = await openBrowser({
        onDomain: (domain) => {
          const session = sessions.get(id);
          if (session && session.domains.size < DOMAIN_LIMIT) {
            session.domains.add(domain);
          }
        },
        onClose: () => {
          if (sessions.get(id)?.closing === false) {
            void close(id, 'crashed');
          }
        },
      });
    } catch (error) {
      throw new BrowserError('launch_failed', String(error?.message ?? error).split('\n')[0], 503);
    } finally {
      const left = (launching.get(owner) ?? 1) - 1;
      if (left > 0) {
        launching.set(owner, left);
      } else {
        launching.delete(owner);
      }
    }
    const startedAt = now();
    const session = {
      id,
      owner,
      /* The conversation the browser belongs to, so each chat keeps its own */
      context: String(context).slice(0, 64),
      /* The model drives it until it hands it over, or the user takes it */
      control: 'model',
      handoff: null,
      url: 'about:blank',
      title: '',
      startedAt,
      lastActiveAt: startedAt,
      idleMs,
      maxMs,
      domains: new Set(),
      handle,
      closing: false,
    };
    sessions.set(id, session);
    return summary(session);
  }

  /**
   * Runs one step on an open browser and counts it as activity. `by` is who acts: the model's
   * steps wait while the user has the browser, and the user's input waits while the model has it.
   */
  async function use(id, step, { by } = {}) {
    const session = find(id);
    if (by === 'model' && session.control === 'user') {
      throw new BrowserError('user_control', 'The user has the browser', 409);
    }
    if (by === 'user' && session.control !== 'user') {
      throw new BrowserError('model_control', 'Take the browser before using it', 409);
    }
    session.lastActiveAt = now();
    try {
      const result = await step(session.handle);
      if (result && typeof result.url === 'string') {
        session.url = result.url;
        session.title = typeof result.title === 'string' ? result.title : session.title;
      }
      return result;
    } finally {
      if (sessions.get(id) === session) {
        session.lastActiveAt = now();
      }
    }
  }

  /** Gives the browser to the user (with why) or back to the model. */
  function setControl(id, to, handoff) {
    const session = find(id);
    session.control = to === 'user' ? 'user' : 'model';
    session.handoff = session.control === 'user' ? readHandoff(handoff) : null;
    session.lastActiveAt = now();
    return summary(session);
  }

  async function sweep() {
    const at = now();
    const due = [];
    for (const session of sessions.values()) {
      if (session.closing) {
        continue;
      }
      if (at - session.startedAt >= session.maxMs) {
        due.push(close(session.id, 'timeout'));
      } else if (at - session.lastActiveAt >= session.idleMs) {
        due.push(close(session.id, 'idle'));
      }
    }
    await Promise.all(due);
  }

  return {
    create,
    close,
    use,
    sweep,
    touch: (id) => {
      find(id).lastActiveAt = now();
    },
    setControl,
    get: (id) => summary(find(id)),
    /** Open browsers, optionally one owner's, and optionally one conversation's. */
    list: ({ owner, context } = {}) =>
      [...sessions.values()]
        .filter((session) => !session.closing)
        .filter((session) => owner == null || session.owner === owner)
        .filter((session) => context == null || session.context === context)
        .map(summary),
    /** The handle of an open browser, for the live view */
    handle: (id) => find(id).handle,
    count: openCount,
    /** Ended sessions after `after` (a sequence number), oldest first. */
    events: (after = 0) => ({ events: events.filter((event) => event.seq > after), last: seq }),
    start() {
      if (!timer) {
        timer = setInterval(() => void sweep(), sweepMs);
        timer.unref();
      }
    },
    async shutdown() {
      clearInterval(timer);
      timer = undefined;
      await Promise.all([...sessions.keys()].map((id) => close(id, 'shutdown')));
    },
  };
}
