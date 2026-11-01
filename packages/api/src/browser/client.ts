import type {
  TBrowserInput,
  TBrowserControl,
  TBrowserHandoff,
  TBrowserEndReason,
  TServerLoadPoint,
  TBrowserInputResult,
} from 'librechat-data-provider';
import type { BrowserServiceTarget } from './config';

const TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 45_000;

/** A browser as the service reports it. */
export interface ServiceSession {
  id: string;
  owner: string;
  /** The conversation it belongs to */
  context?: string;
  control?: TBrowserControl;
  handoff?: TBrowserHandoff | null;
  url?: string;
  title?: string;
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
  context?: string;
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

/** A page after the model's step, as text with element refs. */
export interface ServicePage {
  url: string;
  title: string;
  snapshot?: string;
  offset?: number;
  total?: number;
  truncated?: boolean;
  /** Requests the egress proxy refused, latest last */
  blocked?: Array<{ host: string; reason: string }>;
}

export interface BrowserStepOptions {
  /** Return the page text after the step */
  snapshot?: boolean;
  chars?: number;
}

export interface BrowserServiceClient {
  status(): Promise<ServiceStatus>;
  events(after: number): Promise<ServiceEvents>;
  createSession(input: CreateSessionInput): Promise<ServiceSession>;
  /** The ended session, or null when the service no longer had it */
  closeSession(
    id: string,
    reason?: 'closed' | 'admin' | 'replaced',
  ): Promise<EndedServiceSession | null>;
  /** Open browsers, optionally one owner's in one conversation */
  listSessions(filter?: { owner?: string; context?: string }): Promise<ServiceSession[]>;
  /** One open browser, or null when it is closed */
  getSession(id: string): Promise<ServiceSession | null>;
  open(id: string, url: string, options?: BrowserStepOptions): Promise<ServicePage>;
  read(id: string, options?: { offset?: number; chars?: number }): Promise<ServicePage>;
  act(
    id: string,
    step: Record<string, unknown>,
    options?: BrowserStepOptions,
  ): Promise<ServicePage>;
  setControl(id: string, to: TBrowserControl, handoff?: TBrowserHandoff): Promise<ServiceSession>;
  input(id: string, input: TBrowserInput): Promise<TBrowserInputResult>;
  /** The live view's event stream, as the service sends it */
  frames(
    id: string,
    options: { fps: number; quality: number; signal: AbortSignal },
  ): Promise<Response>;
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

  /** A POST to the service that answers 200 with the result, or throws its coded refusal. */
  async function step<T>(path: string, body: unknown): Promise<T> {
    const { status, body: result } = await call<T>('POST', path, body, LAUNCH_TIMEOUT_MS);
    if (status !== 200) {
      throw fail(status, result);
    }
    return result;
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
    async listSessions(filter = {}) {
      const query = new URLSearchParams();
      if (filter.owner) {
        query.set('owner', filter.owner);
      }
      if (filter.context != null) {
        query.set('context', filter.context);
      }
      const { status, body } = await call<{ sessions: ServiceSession[] }>(
        'GET',
        `/sessions${query.size > 0 ? `?${query}` : ''}`,
      );
      if (status !== 200) {
        throw fail(status, body);
      }
      return body.sessions;
    },
    async getSession(id) {
      const { status, body } = await call<{ session: ServiceSession }>(
        'GET',
        `/sessions/${encodeURIComponent(id)}`,
      );
      if (status === 404) {
        return null;
      }
      if (status !== 200) {
        throw fail(status, body);
      }
      return body.session;
    },
    async open(id, url, options = {}) {
      return step<ServicePage>(`/sessions/${encodeURIComponent(id)}/open`, { url, ...options });
    },
    async read(id, options = {}) {
      return step<ServicePage>(`/sessions/${encodeURIComponent(id)}/read`, options);
    },
    async act(id, input, options = {}) {
      return step<ServicePage>(`/sessions/${encodeURIComponent(id)}/act`, { ...input, ...options });
    },
    async setControl(id, to, handoff) {
      const { session } = await step<{ session: ServiceSession }>(
        `/sessions/${encodeURIComponent(id)}/control`,
        { to, ...(handoff && { handoff }) },
      );
      return session;
    },
    async input(id, input) {
      return step<TBrowserInputResult>(`/sessions/${encodeURIComponent(id)}/input`, input);
    },
    async frames(id, { fps, quality, signal }) {
      let response: Response;
      try {
        response = await fetchImpl(
          `${target.url}/sessions/${encodeURIComponent(id)}/frames?fps=${fps}&quality=${quality}`,
          { headers: { Authorization: `Bearer ${target.token}` }, signal },
        );
      } catch (error) {
        throw new BrowserServiceError(
          'unavailable',
          `The browser service did not answer: ${(error as Error)?.message ?? error}`,
        );
      }
      if (response.status !== 200) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw fail(response.status, body);
      }
      return response;
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
