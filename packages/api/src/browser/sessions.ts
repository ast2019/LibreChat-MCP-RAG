import { logger } from '@librechat/data-schemas';
import type { TBrowserEndReason, TBrowserRefusal } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { BrowserServiceClient, EndedServiceSession, ServiceSession } from './client';
import type { BrowserUser } from './config';
import { getBrowserConfig, resolveUserBrowserAccess } from './config';
import { BrowserServiceError } from './client';

/** The log writes the browser paths make (implemented by `@librechat/data-schemas`). */
export interface BrowserLogStore {
  recordBrowserSessionStart(input: {
    userId: string;
    sessionId: string;
    startedAt?: Date;
    keepDays: number;
  }): Promise<void>;
  recordBrowserSessionEnd(input: {
    sessionId: string;
    reason: TBrowserEndReason;
    endedAt?: Date;
    durationMs?: number;
    domains?: string[];
  }): Promise<boolean>;
  recordBrowserRefusal(input: {
    userId: string;
    reason: TBrowserRefusal;
    detail?: string;
    at?: Date;
    keepDays: number;
  }): Promise<void>;
  listOpenBrowserSessionIds(): Promise<string[]>;
}

export type OpenBrowserResult =
  | { ok: true; session: ServiceSession }
  | { ok: false; reason: TBrowserRefusal; detail?: string };

const REFUSALS: ReadonlySet<string> = new Set([
  'capacity',
  'server_full',
  'user_limit',
  'launch_failed',
]);

/** The user message for a full server, as the owner wrote it. */
export const BROWSER_CAPACITY_MESSAGE = 'ظرفیت فعلاً وجود ندارد، با پشتیبانی تماس بگیرید.';

const quietly = (label: string) => (error: unknown) =>
  logger.warn(`[browser] could not log the ${label}:`, error);

/**
 * Opens a browser for this user: checks access, then asks the service, which checks the
 * per-user and server-wide limits and the RAM/CPU thresholds in one step. Every refusal is
 * logged with the user who asked, so the admin's browser log shows who hit which limit.
 */
export async function openUserBrowser({
  user,
  appConfig,
  client,
  log,
}: {
  user: BrowserUser;
  appConfig: AppConfig | null | undefined;
  client: BrowserServiceClient | null;
  log: BrowserLogStore;
}): Promise<OpenBrowserResult> {
  const config = getBrowserConfig(appConfig);
  const userId = String(user.id ?? user._id ?? '');
  if (!config.enabled || !client || userId === '') {
    return { ok: false, reason: 'unavailable' };
  }
  const refuse = async (reason: TBrowserRefusal, detail?: string): Promise<OpenBrowserResult> => {
    await log
      .recordBrowserRefusal({ userId, reason, detail, keepDays: config.logDays })
      .catch(quietly('refusal'));
    return { ok: false, reason, ...(detail && { detail }) };
  };
  const access = resolveUserBrowserAccess(user, appConfig);
  if (!access.allowed) {
    return refuse('not_allowed', access.source);
  }
  try {
    const session = await client.createSession({
      owner: userId,
      ownerLimit: access.sessions,
      serverLimit: config.maxSessions,
      ram: config.capacity.ram,
      cpu: config.capacity.cpu,
      idleMs: Math.round(config.idleMinutes * 60_000),
      maxMs: config.maxMinutes * 60_000,
    });
    await log
      .recordBrowserSessionStart({
        userId,
        sessionId: session.id,
        startedAt: new Date(session.startedAt),
        keepDays: config.logDays,
      })
      .catch(quietly('start'));
    return { ok: true, session };
  } catch (error) {
    const code = error instanceof BrowserServiceError ? error.code : 'unavailable';
    const reason = (REFUSALS.has(code) ? code : 'unavailable') as TBrowserRefusal;
    /* `ram`/`cpu` for capacity; the technical cause when it failed to open or did not answer. */
    const technical = reason === 'launch_failed' || reason === 'unavailable';
    const detail =
      error instanceof BrowserServiceError
        ? (error.detail ?? (technical ? error.message.slice(0, 200) : undefined))
        : undefined;
    if (reason === 'unavailable' || reason === 'launch_failed') {
      logger.warn(`[browser] no browser for ${userId}: ${(error as Error)?.message ?? error}`);
    }
    return refuse(reason, detail);
  }
}

/** Writes how a browser ended into the log. */
export async function recordBrowserEnd(
  log: BrowserLogStore,
  ended: EndedServiceSession,
): Promise<void> {
  await log.recordBrowserSessionEnd({
    sessionId: ended.id,
    reason: ended.reason,
    endedAt: new Date(ended.endedAt),
    durationMs: ended.durationMs,
    domains: ended.domains,
  });
}

/** Closes a browser (the user's or the model's step, or the admin's force-close) and logs it. */
export async function closeUserBrowser({
  sessionId,
  reason = 'closed',
  client,
  log,
}: {
  sessionId: string;
  reason?: 'closed' | 'admin';
  client: BrowserServiceClient;
  log: BrowserLogStore;
}): Promise<EndedServiceSession | null> {
  const ended = await client.closeSession(sessionId, reason);
  if (ended) {
    await recordBrowserEnd(log, ended).catch(quietly('end'));
  }
  return ended;
}

export interface BrowserLogSync {
  /** One pass; concurrent calls share the pass in progress. Never throws. */
  syncOnce(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * Keeps the log in step with the service: writes the ends the service reports (idle, timeout,
 * crash), and marks `lost` the browsers the log still has open that the service no longer
 * knows, as after a restart of the service.
 */
export function createBrowserLogSync({
  client,
  log,
  intervalMs = 30_000,
}: {
  client: BrowserServiceClient;
  log: BrowserLogStore;
  intervalMs?: number;
}): BrowserLogSync {
  let cursor = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;

  async function pass() {
    /* Order matters: open entries first, then the live list, then the ends. An entry that is
       open in the log was opened before the live list was read, so it is either on that list
       or its end is among the events read after it. */
    const open = await log.listOpenBrowserSessionIds();
    const live =
      open.length > 0 ? new Set((await client.status()).sessions.map((s) => s.id)) : null;
    let batch = await client.events(cursor);
    if (batch.last < cursor) {
      /* The service restarted and counts from zero again. */
      cursor = 0;
      batch = await client.events(0);
    }
    for (const event of batch.events) {
      if (event.type === 'ended') {
        await recordBrowserEnd(log, event.session);
      }
    }
    cursor = batch.last;
    if (live) {
      for (const id of open) {
        if (!live.has(id)) {
          await log.recordBrowserSessionEnd({ sessionId: id, reason: 'lost' });
        }
      }
    }
  }

  async function syncOnce(): Promise<void> {
    running ??= pass()
      .catch((error) => {
        if (!(error instanceof BrowserServiceError && error.code === 'unavailable')) {
          logger.warn('[browser] log sync failed:', error);
        }
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  return {
    syncOnce,
    start() {
      if (!timer) {
        timer = setInterval(() => void syncOnce(), intervalMs);
        timer.unref?.();
      }
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
