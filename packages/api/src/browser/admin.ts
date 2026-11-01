import { logger } from '@librechat/data-schemas';
import { BROWSER_END_REASONS, BROWSER_REFUSALS } from 'librechat-data-provider';
import type {
  TBrowserConfig,
  TAdminServerStatus,
  TAdminBrowserLogEntry,
  TBrowserLogFilter,
  TAdminBrowserLogResponse,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { BrowserServiceClient, ServiceStatus } from './client';
import type { ServerRequest } from '~/types/http';
import type { BrowserLogStore } from './sessions';
import { closeUserBrowser } from './sessions';
import { getBrowserConfig } from './config';

/** Points below a threshold at which the admin view turns to «هشدار». */
const WARNING_MARGIN = 10;
/** Share of the server-wide limit at which open browsers count as a warning. */
const WARNING_SESSIONS = 0.8;

const LOG_FILTERS: ReadonlySet<string> = new Set([
  'opened',
  'refused',
  ...BROWSER_REFUSALS,
  ...BROWSER_END_REASONS,
]);

type Load = ServiceStatus['load'];

/**
 * What blocks a new browser right now and the alert state: «پر» when a threshold or the
 * server-wide limit is reached, «هشدار» within ten points of a threshold or at 80% of the limit.
 */
export function describeServerLoad(
  load: Pick<Load, 'ram' | 'cpu' | 'container'>,
  openSessions: number,
  config: Pick<TBrowserConfig, 'capacity' | 'maxSessions'>,
): Pick<TAdminServerStatus, 'state' | 'blocking'> {
  const memory = Math.max(load.ram?.percent ?? 0, load.container?.percent ?? 0);
  const cpu = load.cpu ?? 0;
  const { ram: ramLimit, cpu: cpuLimit } = config.capacity;
  let blocking: TAdminServerStatus['blocking'] = null;
  if (memory >= ramLimit) {
    blocking = 'ram';
  } else if (cpu >= cpuLimit) {
    blocking = 'cpu';
  } else if (openSessions >= config.maxSessions) {
    blocking = 'server_full';
  }
  if (blocking) {
    return { state: 'full', blocking };
  }
  const close =
    memory >= ramLimit - WARNING_MARGIN ||
    cpu >= cpuLimit - WARNING_MARGIN ||
    openSessions >= Math.ceil(config.maxSessions * WARNING_SESSIONS);
  return { state: close ? 'warning' : 'normal', blocking: null };
}

export interface BrowserAdminDeps {
  /** The service client, or null when the service is not configured */
  getClient: () => BrowserServiceClient | null;
  log: BrowserLogStore & {
    listBrowserSessions(params: {
      search?: string;
      filter?: string;
      limit?: number;
      offset?: number;
    }): Promise<{
      total: number;
      entries: Array<
        Omit<TAdminBrowserLogEntry, 'startedAt' | 'endedAt'> & {
          startedAt: Date;
          endedAt?: Date | null;
        }
      >;
    }>;
  };
  /** Names and emails of the users who own open browsers */
  findUsersByIds: (
    ids: string[],
  ) => Promise<Array<{ _id: unknown; name?: string; email?: string }>>;
}

const readInt = (value: unknown, fallback: number) => {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) ? number : fallback;
};

type AdminHandler = (req: ServerRequest, res: Response) => Promise<Response>;

/**
 * The admin's «وضعیت سرور» (RAM, CPU, alert state, open browsers, force-close) and
 * «لاگ مرورگر» (sessions and refusals, newest first).
 */
export function createBrowserAdminHandlers(deps: BrowserAdminDeps): {
  getServerStatus: AdminHandler;
  closeSession: AdminHandler;
  listBrowserLog: AdminHandler;
} {
  async function getServerStatus(req: ServerRequest, res: Response): Promise<Response> {
    const config = getBrowserConfig(req.config);
    const base: TAdminServerStatus = {
      enabled: config.enabled,
      reachable: false,
      state: 'normal',
      blocking: null,
      ram: null,
      cpu: null,
      container: null,
      limits: {
        ram: config.capacity.ram,
        cpu: config.capacity.cpu,
        maxSessions: config.maxSessions,
        idleMinutes: config.idleMinutes,
        maxMinutes: config.maxMinutes,
      },
      sessions: [],
      history: [],
      checkedAt: Date.now(),
    };
    const client = deps.getClient();
    if (!client) {
      return res.status(200).json(base);
    }
    let status: ServiceStatus;
    try {
      status = await client.status();
    } catch (error) {
      logger.warn('[browser] status unavailable:', (error as Error)?.message ?? error);
      return res.status(200).json(base);
    }
    const owners = [...new Set(status.sessions.map((session) => session.owner))];
    const users = owners.length > 0 ? await deps.findUsersByIds(owners).catch(() => []) : [];
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return res.status(200).json({
      ...base,
      reachable: true,
      ...describeServerLoad(status.load, status.sessions.length, config),
      ram: status.load.ram,
      cpu: status.load.cpu,
      container: status.load.container,
      history: status.history,
      checkedAt: status.load.at,
      sessions: status.sessions.map((session) => {
        const owner = byId.get(session.owner);
        return {
          id: session.id,
          user: owner
            ? {
                id: session.owner,
                ...(owner.name && { name: owner.name }),
                ...(owner.email && { email: owner.email }),
              }
            : { id: session.owner },
          startedAt: session.startedAt,
          lastActiveAt: session.lastActiveAt,
          domains: session.domains,
        };
      }),
    } satisfies TAdminServerStatus);
  }

  async function closeSession(req: ServerRequest, res: Response): Promise<Response> {
    const { id } = (req.params ?? {}) as { id?: string };
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) {
      return res.status(400).json({ error: 'invalid_session' });
    }
    const client = deps.getClient();
    if (!client) {
      return res.status(503).json({ error: 'unavailable' });
    }
    try {
      const ended = await closeUserBrowser({
        sessionId: id,
        reason: 'admin',
        client,
        log: deps.log,
      });
      return res.status(200).json({ closed: ended != null });
    } catch (error) {
      logger.warn('[browser] force-close failed:', (error as Error)?.message ?? error);
      return res.status(503).json({ error: 'unavailable' });
    }
  }

  async function listBrowserLog(req: ServerRequest, res: Response): Promise<Response> {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const filter =
      typeof query.filter === 'string' && LOG_FILTERS.has(query.filter)
        ? (query.filter as TBrowserLogFilter)
        : undefined;
    const search = typeof query.search === 'string' ? query.search : undefined;
    const limit = Math.min(Math.max(readInt(query.limit, 25), 1), 100);
    const offset = Math.max(readInt(query.offset, 0), 0);
    try {
      const { total, entries } = await deps.log.listBrowserSessions({
        search,
        filter,
        limit,
        offset,
      });
      const body: TAdminBrowserLogResponse = {
        total,
        limit,
        offset,
        entries: entries.map((entry) => ({
          ...entry,
          startedAt: entry.startedAt.toISOString(),
          ...(entry.endedAt ? { endedAt: entry.endedAt.toISOString() } : { endedAt: undefined }),
        })),
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[browser] log list failed:', error);
      return res.status(500).json({ error: 'Failed to list the browser log' });
    }
  }

  return { getServerStatus, closeSession, listBrowserLog };
}
