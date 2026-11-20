import type { WorkerRenderRequest } from './scene';
import type { RemotionServiceTarget } from './config';

/** Above the worker's own job timeout (7 minutes) so the worker's answer wins the race. */
const RENDER_TIMEOUT_MS = 8 * 60_000;

export class RemotionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
    readonly detail?: string,
    /** Worker stage (bundle, select, tts, render, ...) and job id when the worker sent them. */
    readonly stage?: string,
    readonly jobId?: string,
  ) {
    super(message);
    this.name = 'RemotionServiceError';
  }
}

export interface RemotionRenderResult {
  buffer: Buffer;
  type: string;
  width: number;
  height: number;
  durationSec: number;
  queuedMs?: number;
  renderMs?: number;
  jobId?: string;
  /** Worker timings in ms (bundleMs, ttsMs, selectMs, renderMs) */
  timings?: Record<string, number>;
  /** Non-fatal worker notes, e.g. `tts_failed: ...` (the clip has no voice) */
  warnings: string[];
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
  /** Worker `/status` (authenticated): bundle, self-checks, config, memory, counters, last jobs. */
  status(): Promise<Record<string, unknown>>;
  /** Worker `/logs` (authenticated): the worker container's own log ring. */
  logs(
    query?: RemotionLogsQuery,
  ): Promise<{ entries: Array<Record<string, unknown>>; lastId?: number }>;
  render(input: WorkerRenderRequest): Promise<RemotionRenderResult>;
}

interface WorkerErrorBody {
  error?: string;
  message?: string;
  detail?: string;
  stage?: string;
  jobId?: string;
}

/** Calls the Remotion worker; every failure becomes a {@link RemotionServiceError}. */
export function createRemotionServiceClient(
  target: RemotionServiceTarget,
  fetchImpl: typeof fetch = fetch,
): RemotionServiceClient {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 15_000,
  ): Promise<{ status: number; body: T & WorkerErrorBody }> {
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
      const err = error as { name?: string; code?: string; cause?: { code?: string } };
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new RemotionServiceError(
          'timeout',
          `The Remotion service timed out after ${Math.round(timeoutMs / 1000)}s`,
          504,
        );
      }
      const reason = err?.cause?.code ?? err?.code ?? err?.name ?? 'unknown';
      throw new RemotionServiceError(
        'unavailable',
        `The Remotion service connection failed: ${reason}`,
      );
    }
    let parsed: T & WorkerErrorBody;
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new RemotionServiceError('unavailable', 'The Remotion service sent no JSON');
    }
    return { status: response.status, body: parsed };
  }

  return {
    async health() {
      const { status, body } = await call<RemotionHealth>('GET', '/health');
      if (status !== 200 || body.ok !== true) {
        throw new RemotionServiceError(
          'unavailable',
          body.message ?? 'Remotion health failed',
          status,
        );
      }
      return body;
    },
    async status() {
      const { status, body } = await call<Record<string, unknown>>('GET', '/status');
      if (status !== 200) {
        throw new RemotionServiceError(
          status === 401 ? 'unauthorized' : 'unavailable',
          body.message ?? `The Remotion service answered ${status}`,
          status,
        );
      }
      return body;
    },
    async logs({ limit = 150, level = 'info', after }: RemotionLogsQuery = {}) {
      const query = new URLSearchParams({ limit: String(limit), level });
      if (after != null) {
        query.set('after', String(after));
      }
      const { status, body } = await call<{
        entries?: Array<Record<string, unknown>>;
        lastId?: number;
      }>('GET', `/logs?${query.toString()}`);
      if (status !== 200) {
        throw new RemotionServiceError(
          status === 401 ? 'unauthorized' : 'unavailable',
          body.message ?? `The Remotion service answered ${status}`,
          status,
        );
      }
      return { entries: Array.isArray(body.entries) ? body.entries : [], lastId: body.lastId };
    },
    async render(input) {
      const { status, body } = await call<{
        ok?: boolean;
        videoBase64?: string;
        mime?: string;
        width?: number;
        height?: number;
        durationSec?: number;
        queuedMs?: number;
        renderMs?: number;
        timings?: Record<string, number>;
        warnings?: unknown;
      }>('POST', '/render', input, RENDER_TIMEOUT_MS);
      if (status === 429) {
        throw new RemotionServiceError(
          'busy',
          body.message ?? 'The Remotion worker is busy; try again shortly.',
          429,
          body.detail,
          body.stage,
          body.jobId,
        );
      }
      if (status !== 200 || body.ok !== true || !body.videoBase64) {
        throw new RemotionServiceError(
          body.error ?? (status === 401 ? 'unauthorized' : 'render_failed'),
          body.message ?? `The Remotion service answered ${status}`,
          status,
          body.detail,
          body.stage,
          body.jobId,
        );
      }
      return {
        buffer: Buffer.from(body.videoBase64, 'base64'),
        type: body.mime ?? 'video/mp4',
        width: body.width ?? input.width,
        height: body.height ?? input.height,
        durationSec: body.durationSec ?? input.durationSec,
        queuedMs: body.queuedMs,
        renderMs: body.renderMs,
        jobId: body.jobId,
        timings: body.timings,
        warnings: Array.isArray(body.warnings)
          ? body.warnings.filter((w): w is string => typeof w === 'string')
          : [],
      };
    },
  };
}
