import type { WorkerRenderRequest } from './scene';
import type { RemotionServiceTarget } from './config';

const RENDER_TIMEOUT_MS = 5 * 60_000;

export class RemotionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
    readonly detail?: string,
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
}

export interface RemotionServiceClient {
  health(): Promise<{ ok: boolean }>;
  render(input: WorkerRenderRequest): Promise<RemotionRenderResult>;
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
      throw new RemotionServiceError(
        'unavailable',
        `The Remotion service did not answer: ${(error as Error)?.message ?? error}`,
      );
    }
    let parsed: T & { error?: string; message?: string; detail?: string };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new RemotionServiceError('unavailable', 'The Remotion service sent no JSON');
    }
    return { status: response.status, body: parsed };
  }

  return {
    async health() {
      const { status, body } = await call<{ ok?: boolean }>('GET', '/health');
      if (status !== 200 || body.ok !== true) {
        throw new RemotionServiceError('unavailable', body.message ?? 'Remotion health failed');
      }
      return { ok: true };
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
      }>('POST', '/render', input, RENDER_TIMEOUT_MS);
      if (status === 429) {
        throw new RemotionServiceError(
          'busy',
          body.message ?? 'The Remotion worker is busy; try again shortly.',
          429,
          body.detail,
        );
      }
      if (status !== 200 || body.ok !== true || !body.videoBase64) {
        throw new RemotionServiceError(
          body.error ?? (status === 401 ? 'unauthorized' : 'render_failed'),
          body.message ?? `The Remotion service answered ${status}`,
          status,
          body.detail,
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
      };
    },
  };
}
