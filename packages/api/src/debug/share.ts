import { logger } from '@librechat/data-schemas';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

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
  notes: string[];
};

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
      return res.status(200).json(record.snapshot);
    } catch (error) {
      logger.error('[debug/share] fetch failed', error);
      return res.status(500).json({ error: 'Failed to read debug share' });
    }
  }

  return { mintShare, fetchShare };
}
