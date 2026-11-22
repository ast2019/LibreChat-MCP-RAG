import { logger, redactMessage } from '@librechat/data-schemas';
import { createHash, randomBytes } from 'node:crypto';
import type { TDebugLogLine } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { RemotionDiagnostics } from '~/clip/probe';

export const DEBUG_SHARE_DEFAULT_TTL_MS: number = 60 * 60 * 1000;
export const DEBUG_SHARE_MAX_TTL_MS: number = 24 * 60 * 60 * 1000;

export type DebugShareSnapshot = {
  generatedAt: string;
  expiresAt: string;
  appVersion?: string;
  librechatVersion?: string;
  build?: { commit?: string; branch?: string; date?: string };
  codeBridge?: {
    configured: boolean;
    healthOk?: boolean;
    statusCode?: number;
  };
  attach?: {
    principalWorkersEnabled?: boolean;
    maxPerUser?: number;
    environmentsConfigured?: number;
  };
  browser?: {
    enabled?: boolean;
    openSessions?: number | null;
  };
  debugMode?: { enabled: boolean; level?: string };
  /** Recent log lines of this process, re-redacted for sharing (see {@link selectShareLogLines}) */
  logs?: DebugShareLogs;
  /** Remotion worker diagnostics, every string masked (see {@link buildRemotionShareSection}) */
  remotion?: RemotionDiagnostics;
  notes: string[];
};

export type DebugShareLogs = {
  /** Oldest first */
  lines: TDebugLogLine[];
  /** Lines in the window before the cap cut the oldest */
  total: number;
  windowMinutes: number;
  /** `debug`: captured while debug mode was on (its level and above); `problems`: warnings and
   *  errors kept at all times */
  sources: Array<'debug' | 'problems'>;
};

export const DEBUG_SHARE_LOG_LINES = 300;
export const DEBUG_SHARE_LOG_WINDOW_MINUTES = 120;
const SHARE_LINE_CHARS = 1_000;

const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g;
/** Four or more hex groups: IPv6, never a `12:33:28` time */
const IPV6 = /\b([0-9a-f]{1,4})(?::[0-9a-f]{0,4}){3,7}\b/gi;

/**
 * A log text made safe for a link anyone holding the code can open: the logger's redaction
 * again (tokens, keys, cookies, emails), IP addresses cut to their network, and a length cap.
 */
/**
 * A stack frame's location: `(file:///app/node_modules/@remotion/renderer/x.js:10:5)`, a bare
 * `at /app/x.js:1:2`, or a Windows path. Scoped packages put an `@` in the path, which the email
 * redaction would otherwise read as `local@domain.js` and mask the whole frame.
 */
const STACK_LOCATION =
  /(?<=\(|\bat )(?:file:\/\/\/?|\/|[A-Za-z]:\\)[^()\s]*?:\d+(?::\d+)?(?=\)|\s|$)/g;
/** A real address inside a protected location: no slash on either side of the `@`. */
const PATH_EMAIL = /[^\s/\\()@:]+@[^\s/\\()@:]+\.[A-Za-z]{2,}/g;
const FRAME_SLOT = (i: number): string => `\u0000frame${i}\u0000`;

export function maskShareLogText(text: string): string {
  const frames: string[] = [];
  const shielded = text.replace(STACK_LOCATION, (location) => {
    frames.push(location.replace(PATH_EMAIL, '[REDACTED_EMAIL]'));
    return FRAME_SLOT(frames.length - 1);
  });
  return redactMessage(shielded)
    .replace(/\u0000frame(\d+)\u0000/g, (_, i: string) => frames[Number(i)] ?? '')
    .replace(IPV4, '$1.$2.x.x')
    .replace(IPV6, '$1:…')
    .slice(0, SHARE_LINE_CHARS);
}

export const DEBUG_SHARE_REMOTION_MAX_BYTES = 60_000;

function maskDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') {
    return maskShareLogText(value) as T;
  }
  if (depth > 8 || value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item, depth + 1)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = maskDeep(item, depth + 1);
  }
  return out as T;
}

/**
 * The `remotion` section of a share: every string masked, and kept under about 60 KB by
 * dropping the oldest worker log lines and API clip events first.
 */
export function buildRemotionShareSection(
  diagnostics: RemotionDiagnostics,
  maxBytes: number = DEBUG_SHARE_REMOTION_MAX_BYTES,
): RemotionDiagnostics {
  const masked = maskDeep(diagnostics);
  const size = () => Buffer.byteLength(JSON.stringify(masked));
  while (size() > maxBytes && (masked.workerLogs.length > 20 || masked.clipEvents.length > 20)) {
    masked.workerLogs = masked.workerLogs.slice(Math.ceil(masked.workerLogs.length * 0.2));
    masked.clipEvents = masked.clipEvents.slice(Math.ceil(masked.clipEvents.length * 0.2));
  }
  if (size() > maxBytes) {
    masked.status = undefined;
    masked.hints.push('The worker status was left out: it exceeded the size limit.');
  }
  return masked;
}

/**
 * The lines a share shows: both sources merged (a line in both appears once), the last
 * `windowMinutes`, oldest first, at most `maxLines` (the newest kept), each masked.
 */
export function selectShareLogLines(
  sources: { debug?: TDebugLogLine[]; problems?: TDebugLogLine[] },
  {
    now = Date.now(),
    maxLines = DEBUG_SHARE_LOG_LINES,
    windowMinutes = DEBUG_SHARE_LOG_WINDOW_MINUTES,
  }: { now?: number; maxLines?: number; windowMinutes?: number } = {},
): DebugShareLogs {
  const since = now - windowMinutes * 60_000;
  const seen = new Set<string>();
  const merged: TDebugLogLine[] = [];
  const used: Array<'debug' | 'problems'> = [];
  for (const key of ['debug', 'problems'] as const) {
    const lines = sources[key];
    if (!lines?.length) {
      continue;
    }
    used.push(key);
    for (const line of lines) {
      const at = Date.parse(line.at);
      const id = `${line.at}|${line.level}|${line.message}`;
      if (Number.isNaN(at) || at < since || seen.has(id)) {
        continue;
      }
      seen.add(id);
      merged.push(line);
    }
  }
  merged.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const kept = merged.slice(-maxLines);
  return {
    total: merged.length,
    windowMinutes,
    sources: used,
    lines: kept.map((line) => ({
      at: line.at,
      level: line.level,
      message: maskShareLogText(line.message),
      ...(line.meta && { meta: maskShareLogText(line.meta) }),
      ...(line.traceId && { traceId: line.traceId }),
    })),
  };
}

type ShareRecord = {
  hash: string;
  expiresAt: number;
  createdBy?: string;
  snapshot: DebugShareSnapshot;
};

export interface DebugShareStore {
  save(record: ShareRecord): Promise<void>;
  /** Returns the record for this hash if present and not expired. */
  take(hash: string): Promise<ShareRecord | null>;
}

/** Process-local store; fine for a single api replica and short TTL codes. */
export function createMemoryDebugShareStore(): DebugShareStore {
  let current: ShareRecord | null = null;
  return {
    async save(record) {
      current = record;
    },
    async take(hash) {
      if (!current || current.hash !== hash) {
        return null;
      }
      if (current.expiresAt <= Date.now()) {
        current = null;
        return null;
      }
      return current;
    },
  };
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function mintCode(): string {
  return randomBytes(24).toString('base64url');
}

export type BuildDebugShareSnapshot = () => Promise<
  Omit<DebugShareSnapshot, 'generatedAt' | 'expiresAt'>
>;

export interface DebugShareHandlers {
  mintShare: (req: Request, res: Response) => Promise<Response>;
  fetchShare: (req: Request, res: Response) => Promise<Response>;
}

export function createDebugShareHandlers(deps: {
  store?: DebugShareStore;
  buildSnapshot: BuildDebugShareSnapshot;
  publicBaseUrl?: () => string | undefined;
  defaultTtlMs?: number;
}): DebugShareHandlers {
  const store = deps.store ?? createMemoryDebugShareStore();
  const defaultTtlMs = deps.defaultTtlMs ?? DEBUG_SHARE_DEFAULT_TTL_MS;

  async function mintShare(req: Request, res: Response) {
    const body = (req.body ?? {}) as { ttlMs?: unknown };
    let ttlMs = defaultTtlMs;
    if (body.ttlMs !== undefined) {
      if (typeof body.ttlMs !== 'number' || !Number.isFinite(body.ttlMs) || body.ttlMs < 60_000) {
        return res.status(400).json({ error: 'ttlMs must be at least 60000' });
      }
      ttlMs = Math.min(Math.trunc(body.ttlMs), DEBUG_SHARE_MAX_TTL_MS);
    }
    try {
      const code = mintCode();
      const expiresAt = Date.now() + ttlMs;
      const partial = await deps.buildSnapshot();
      const snapshot: DebugShareSnapshot = {
        ...partial,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      };
      await store.save({
        hash: hashCode(code),
        expiresAt,
        createdBy: (req as Request & { user?: { id?: string } }).user?.id,
        snapshot,
      });
      const base = deps.publicBaseUrl?.()?.replace(/\/$/, '') ?? '';
      const path = `/api/debug/share/${code}`;
      return res.status(201).json({
        code,
        expiresAt: snapshot.expiresAt,
        url: base ? `${base}${path}` : path,
      });
    } catch (error) {
      logger.error('[debug/share] mint failed', error);
      return res.status(500).json({ error: 'Failed to create debug share code' });
    }
  }

  async function fetchShare(req: Request, res: Response) {
    const code = typeof req.params?.code === 'string' ? req.params.code.trim() : '';
    if (!code || code.length < 16 || code.length > 128) {
      return res.status(400).json({ error: 'Invalid share code' });
    }
    try {
      const record = await store.take(hashCode(code));
      if (!record) {
        return res.status(404).json({ error: 'Share code not found or expired' });
      }
      /** Built again on each read, so the link shows what happened after it was made (an
       *  admin reproduces the problem, then the helper opens the same link). The stored copy
       *  answers if the rebuild fails. */
      try {
        const partial = await deps.buildSnapshot();
        return res.status(200).json({
          ...partial,
          generatedAt: new Date().toISOString(),
          expiresAt: record.snapshot.expiresAt,
        });
      } catch (error) {
        logger.warn('[debug/share] live rebuild failed; serving the minted snapshot', error);
        return res.status(200).json(record.snapshot);
      }
    } catch (error) {
      logger.error('[debug/share] fetch failed', error);
      return res.status(500).json({ error: 'Failed to read debug share' });
    }
  }

  return { mintShare, fetchShare };
}
