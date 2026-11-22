import type { RemotionServiceTarget } from './config';
import type { WorkerJobRequest } from './scene';

/**
 * Every call to the worker is short: jobs run in the background, so no request waits for a
 * render (the 0.39 synchronous `/render` hit undici's 300 s header timeout while the worker
 * allowed 420 s). Submits carry the assets, so they get a longer budget.
 */
export const WORKER_CALL_TIMEOUT_MS = 20_000;
export const WORKER_SUBMIT_TIMEOUT_MS = 90_000;
export const WORKER_DOWNLOAD_TIMEOUT_MS = 180_000;
export const WORKER_STILLS_TIMEOUT_MS = 150_000;

export class RemotionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
    readonly detail?: string,
    readonly stage?: string,
    readonly jobId?: string,
    /** Field-level validation errors from the worker */
    readonly errors?: string[],
  ) {
    super(message);
    this.name = 'RemotionServiceError';
  }
}

export type WorkerJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** `GET /jobs/:id` on the worker. */
export interface WorkerJobView {
  jobId: string;
  state: WorkerJobState;
  stage: string;
  progress: number;
  position?: number;
  timeoutMs?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  bytes?: number;
  timings?: Record<string, number>;
  warnings: string[];
  error?: string;
  message?: string;
}

export interface WorkerStill {
  frame: number;
  mime: string;
  base64: string;
}

export interface RemotionHealth {
  ok: boolean;
  ready?: boolean;
  bundle?: string;
  uptimeSec?: number;
  active?: number;
  waiting?: number;
  maxConcurrent?: number;
  maxQueue?: number;
}

export interface RemotionLogsQuery {
  limit?: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
  after?: number;
}

export interface RemotionServiceClient {
  health(): Promise<RemotionHealth>;
  /** Worker `/status` (authenticated): bundle, self-checks, config, memory, counters, jobs. */
  status(): Promise<Record<string, unknown>>;
  /** Worker `/logs` (authenticated): the worker container's own log ring. */
  logs(
    query?: RemotionLogsQuery,
  ): Promise<{ entries: Array<Record<string, unknown>>; lastId?: number }>;
  /** Queues a render; answers at once with the job's id and position. */
  submit(input: WorkerJobRequest): Promise<WorkerJobView>;
  job(jobId: string): Promise<WorkerJobView>;
  /** Stops a queued or running render (renderMedia's cancel signal on the worker). */
  cancel(jobId: string): Promise<WorkerJobView>;
  video(jobId: string): Promise<Buffer>;
  stills(input: WorkerJobRequest): Promise<{ stills: WorkerStill[]; warnings: string[] }>;
}

interface WorkerErrorBody {
  ok?: boolean;
  error?: string;
  message?: string;
  detail?: string;
  stage?: string;
  jobId?: string;
  errors?: string[];
}

const toView = (body: Record<string, unknown>): WorkerJobView => ({
  ...(body as unknown as WorkerJobView),
  warnings: Array.isArray(body.warnings)
    ? body.warnings.filter((w): w is string => typeof w === 'string')
    : [],
});

/** Calls the Remotion worker; every failure becomes a {@link RemotionServiceError}. */
export function createRemotionServiceClient(
  target: RemotionServiceTarget,
  fetchImpl: typeof fetch = fetch,
): RemotionServiceClient {
  async function send(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetchImpl(`${target.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${target.token}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const err = error as { name?: string; code?: string; cause?: { code?: string } };
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new RemotionServiceError(
          'timeout',
          `The Remotion service did not answer within ${Math.round(timeoutMs / 1000)}s`,
          504,
        );
      }
      const reason = err?.cause?.code ?? err?.code ?? err?.name ?? 'unknown';
      throw new RemotionServiceError(
        'unavailable',
        `The Remotion service connection failed: ${reason}`,
      );
    }
  }

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = WORKER_CALL_TIMEOUT_MS,
  ): Promise<T & WorkerErrorBody> {
    const response = await send(method, path, body, timeoutMs);
    let parsed: T & WorkerErrorBody;
    try {
      parsed = (await response.json()) as T & WorkerErrorBody;
    } catch {
      throw new RemotionServiceError('unavailable', 'The Remotion service sent no JSON', 502);
    }
    if (response.status >= 400) {
      const code =
        parsed.error ??
        (response.status === 401 ? 'unauthorized' : response.status === 429 ? 'busy' : 'failed');
      throw new RemotionServiceError(
        code,
        parsed.message ?? `The Remotion service answered ${response.status}`,
        response.status,
        parsed.detail,
        parsed.stage,
        parsed.jobId,
        Array.isArray(parsed.errors) ? parsed.errors : undefined,
      );
    }
    return parsed;
  }

  const jobPath = (jobId: string): string => `/jobs/${encodeURIComponent(jobId)}`;

  return {
    async health() {
      const body = await call<RemotionHealth>('GET', '/health');
      if (body.ok !== true) {
        throw new RemotionServiceError('unavailable', body.message ?? 'Remotion health failed');
      }
      return body;
    },
    status: () => call<Record<string, unknown>>('GET', '/status'),
    async logs({ limit = 150, level = 'info', after }: RemotionLogsQuery = {}) {
      const query = new URLSearchParams({ limit: String(limit), level });
      if (after != null) {
        query.set('after', String(after));
      }
      const body = await call<{ entries?: Array<Record<string, unknown>>; lastId?: number }>(
        'GET',
        `/logs?${query.toString()}`,
      );
      return { entries: Array.isArray(body.entries) ? body.entries : [], lastId: body.lastId };
    },
    async submit(input) {
      return toView(await call<Record<string, unknown>>('POST', '/jobs', input, WORKER_SUBMIT_TIMEOUT_MS));
    },
    async job(jobId) {
      return toView(await call<Record<string, unknown>>('GET', jobPath(jobId)));
    },
    async cancel(jobId) {
      return toView(await call<Record<string, unknown>>('DELETE', jobPath(jobId)));
    },
    async video(jobId) {
      const response = await send('GET', `${jobPath(jobId)}/video`, undefined, WORKER_DOWNLOAD_TIMEOUT_MS);
      if (response.status !== 200) {
        throw new RemotionServiceError('not_ready', `The video is not ready (${response.status})`, response.status);
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async stills(input) {
      const body = await call<{ stills?: WorkerStill[]; warnings?: string[] }>(
        'POST',
        '/stills',
        input,
        WORKER_STILLS_TIMEOUT_MS,
      );
      return {
        stills: Array.isArray(body.stills) ? body.stills : [],
        warnings: Array.isArray(body.warnings) ? body.warnings : [],
      };
    },
  };
}
