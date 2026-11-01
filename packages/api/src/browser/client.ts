import type { TBrowserEndReason, TServerLoadPoint } from 'librechat-data-provider';
import type { BrowserServiceTarget } from './config';

const TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 45_000;

/** A browser as the service reports it. */
export interface ServiceSession {
  id: string;
  owner: string;
  startedAt: number;
  lastActiveAt: number;
  idleMs: number;
  maxMs: number;
  domains: string[];
}

export interface EndedServiceSession extends ServiceSession {
  endedAt: number;
  durationMs: number;
  reason: TBrowserEndReason;
}

export interface ServiceStatus {
  load: {
    at: number;
    ram: { percent: number; used: number; total: number } | null;
    cpu: number | null;
    container: { percent: number; used: number; limit: number } | null;
  };
  history: TServerLoadPoint[];
  sessions: ServiceSession[];
}

export interface ServiceEvents {
  events: Array<{ seq: number; at: number; type: 'ended'; session: EndedServiceSession }>;
  last: number;
}

export interface CreateSessionInput {
  owner: string;
  ownerLimit: number;
  serverLimit: number;
  ram: number;
  cpu: number;
  idleMs: number;
  maxMs: number;
}

/** A refusal or failure from the service, or `unavailable` when it did not answer. */
export class BrowserServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'BrowserServiceError';
  }
}

export interface BrowserServiceClient {
  status(): Promise<ServiceStatus>;
  events(after: number): Promise<ServiceEvents>;
  createSession(input: CreateSessionInput): Promise<ServiceSession>;
  /** The ended session, or null when the service no longer had it */
  closeSession(id: string, reason?: 'closed' | 'admin'): Promise<EndedServiceSession | null>;
}

/** Calls the browser service with its token; every failure becomes a {@link BrowserServiceError}. */
export function createBrowserServiceClient(
  target: BrowserServiceTarget,
  fetchImpl: typeof fetch = fetch,
): BrowserServiceClient {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = TIMEOUT_MS,
  ): Promise<{ status: number; body: T & { error?: string; message?: string; detail?: string } }> {
    let response: Response;
    try {
      response = await fetchImpl(`${target.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${target.token}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BrowserServiceError(
        'unavailable',
        `The browser service did not answer: ${(error as Error)?.message ?? error}`,
      );
    }
    let parsed: T & { error?: string; message?: string; detail?: string };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new BrowserServiceError('unavailable', 'The browser service sent no JSON');
    }
    return { status: response.status, body: parsed };
  }

  const fail = (status: number, body: { error?: string; message?: string; detail?: string }) =>
    new BrowserServiceError(
      body.error ?? (status === 401 ? 'unauthorized' : 'unavailable'),
      body.message ?? `The browser service answered ${status}`,
      status,
      body.detail,
    );

  return {
    async status() {
      const { status, body } = await call<ServiceStatus>('GET', '/status');
      if (status !== 200) {
        throw fail(status, body);
      }
      return body;
    },
    async events(after) {
      const { status, body } = await call<ServiceEvents>(
        'GET',
        `/events?after=${Math.max(0, Math.trunc(after))}`,
      );
      if (status !== 200) {
        throw fail(status, body);
      }
      return body;
    },
    async createSession(input) {
      const { status, body } = await call<{ session: ServiceSession }>(
        'POST',
        '/sessions',
        input,
        LAUNCH_TIMEOUT_MS,
      );
      if (status !== 201) {
        throw fail(status, body);
      }
      return body.session;
    },
    async closeSession(id, reason = 'closed') {
      const { status, body } = await call<{ session: EndedServiceSession }>(
        'DELETE',
        `/sessions/${encodeURIComponent(id)}?reason=${reason}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        throw fail(status, body);
      }
      return body.session;
    },
  };
}
