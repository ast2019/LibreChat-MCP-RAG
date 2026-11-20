import { createRemotionServiceClient, RemotionServiceError } from './client';
import type { RemotionHealth } from './client';
import { getRemotionServiceTarget } from './config';
import { getClipEvents } from './diagnostics';
import type { ClipEvent } from './diagnostics';

const PROBE_TIMEOUT_MS = 5_000;
const WORKER_LOG_LIMIT = 150;
const LOG_MESSAGE_CHARS = 300;

export interface RemotionWorkerLogLine {
  id?: number;
  at?: string;
  level?: string;
  event?: string;
  jobId?: string;
  data?: string;
}

export interface RemotionDiagnostics {
  configured: boolean;
  /** Host name only: no scheme, port, path or credentials */
  urlHost?: string;
  health?: { ok: boolean; ms: number; ready?: boolean; bundle?: string; error?: string };
  /** Worker `/status`; absent when it could not be read */
  status?: Record<string, unknown>;
  statusError?: string;
  workerLogs: RemotionWorkerLogLine[];
  workerLogsError?: string;
  clipEvents: ClipEvent[];
  hints: string[];
}

function withTimeout(fetchImpl: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetchImpl(input, {
      ...init,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })) as typeof fetch;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function errorText(error: unknown): string {
  if (error instanceof RemotionServiceError) {
    return `${error.code}${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}`;
  }
  return String((error as Error)?.message ?? error).slice(0, LOG_MESSAGE_CHARS);
}

function shortJson(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.stringify(value).slice(0, LOG_MESSAGE_CHARS);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function computeHints(d: RemotionDiagnostics, env: Record<string, string | undefined>): string[] {
  const hints: string[] = [];
  if (!d.configured) {
    if (!env.REMOTION_SERVICE_URL?.trim()) {
      hints.push('REMOTION_SERVICE_URL is not set on the api service, so the clip tool is off.');
    } else if (!/^https?:\/\//.test(env.REMOTION_SERVICE_URL.trim())) {
      hints.push('REMOTION_SERVICE_URL must start with http:// or https://.');
    }
    if ((env.REMOTION_SERVICE_TOKEN?.trim().length ?? 0) < 32) {
      hints.push(
        'REMOTION_SERVICE_TOKEN is missing or shorter than 32 characters on the api service.',
      );
    }
    return hints;
  }
  if (d.health && !d.health.ok) {
    hints.push(
      'The worker did not answer /health: the remotion container is down, unhealthy or was OOM-killed. Check the container state and its restart count in Coolify.',
    );
  }
  if (d.statusError?.startsWith('unauthorized')) {
    hints.push(
      'The worker rejected the bearer token (401): REMOTION_SERVICE_TOKEN differs between the api and remotion services. Both should use the same value.',
    );
  }
  const status = asRecord(d.status);
  const bundle = asRecord(status.bundleDetail);
  if (bundle.state === 'failed') {
    const message = asRecord(bundle.error).message;
    hints.push(
      `The worker bundle build failed${typeof message === 'string' ? `: ${message}` : ''}. Renders fail until a build succeeds; check the worker logs.`,
    );
  } else if (bundle.state === 'building' || (d.health?.ok && d.health.ready === false)) {
    hints.push(
      'The worker bundle is still building: the first render waits for it (about 10 to 60 s).',
    );
  }
  const memory = asRecord(asRecord(status.memory).cgroup);
  const limit = Number(memory.limitMb);
  const current = Number(memory.currentMb);
  if (limit > 0 && current / limit > 0.85) {
    hints.push(
      `The worker is near its memory limit (${Math.round(current)} of ${Math.round(limit)} MB); an OOM kill is likely. Lower REMOTION_RENDER_CONCURRENCY or raise the container memory.`,
    );
  }
  const queue = asRecord(status);
  const waiting = Number(queue.waiting);
  const maxQueue = Number(queue.maxQueue);
  if (maxQueue > 0 && waiting >= maxQueue) {
    hints.push('The worker queue is full: new clips are refused with "busy" until renders finish.');
  }
  const checks = asRecord(status.checks);
  for (const [name, label] of [
    ['edgeTts', 'edge-tts is missing: clips with TTS narration will have no voice (tts_failed).'],
    ['chromium', 'Chromium was not found: no clip can render.'],
    ['ffmpeg', 'ffmpeg is missing: audio and encoding steps will fail.'],
    ['ffprobe', 'ffprobe is missing: audio length cannot be probed.'],
  ] as const) {
    if (asRecord(checks[name]).found === false) {
      hints.push(label);
    }
  }
  const failedLast = d.clipEvents.filter((e) => e.level !== 'info').slice(-1)[0];
  if (failedLast) {
    hints.push(
      `Last clip problem on the api side: ${failedLast.event} at ${failedLast.at}${failedLast.data.code ? ` (code ${failedLast.data.code})` : ''}.`,
    );
  }
  if (d.health?.ok && hints.length === 0) {
    hints.push(
      'The worker answers and nothing looks wrong. Read clipEvents and workerLogs for the failing job.',
    );
  }
  return hints;
}

/**
 * Everything needed to diagnose Remotion from one place: config, worker health, worker status and
 * its own logs (the API calls the worker with the bearer token), the API's recent clip events, and
 * plain-language hints. Each probe has a 5 s timeout; this never throws. Contains no secrets, no
 * message text and no media. Callers that publish it must still run strings through their masker.
 */
export async function getRemotionDiagnostics({
  env = process.env,
  fetch: fetchImpl = fetch,
}: {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
} = {}): Promise<RemotionDiagnostics> {
  const diagnostics: RemotionDiagnostics = {
    configured: false,
    workerLogs: [],
    clipEvents: [],
    hints: [],
  };
  try {
    diagnostics.clipEvents = getClipEvents();
    const target = getRemotionServiceTarget(env);
    if (!target) {
      diagnostics.hints = computeHints(diagnostics, env);
      return diagnostics;
    }
    diagnostics.configured = true;
    diagnostics.urlHost = hostOf(target.url);
    const client = createRemotionServiceClient(target, withTimeout(fetchImpl));

    const started = Date.now();
    let health: RemotionHealth | undefined;
    try {
      health = await client.health();
      diagnostics.health = {
        ok: true,
        ms: Date.now() - started,
        ready: health.ready,
        bundle: health.bundle,
      };
    } catch (error) {
      diagnostics.health = { ok: false, ms: Date.now() - started, error: errorText(error) };
    }

    const [status, logs] = await Promise.allSettled([
      client.status(),
      client.logs({ limit: WORKER_LOG_LIMIT, level: 'info' }),
    ]);
    if (status.status === 'fulfilled') {
      diagnostics.status = status.value;
    } else {
      diagnostics.statusError = errorText(status.reason);
    }
    if (logs.status === 'fulfilled') {
      diagnostics.workerLogs = logs.value.entries.slice(-WORKER_LOG_LIMIT).map((entry) => ({
        ...(typeof entry.id === 'number' && { id: entry.id }),
        ...(typeof entry.at === 'string' && { at: entry.at }),
        ...(typeof entry.level === 'string' && { level: entry.level }),
        ...(typeof entry.event === 'string' && { event: entry.event }),
        ...(typeof entry.jobId === 'string' && { jobId: entry.jobId }),
        ...(shortJson(entry.data) && { data: shortJson(entry.data) }),
      }));
    } else {
      diagnostics.workerLogsError = errorText(logs.reason);
    }
    diagnostics.hints = computeHints(diagnostics, env);
  } catch (error) {
    diagnostics.hints.push(`Remotion diagnostics failed: ${errorText(error)}`);
  }
  return diagnostics;
}
