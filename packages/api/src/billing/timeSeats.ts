import { logger } from '@librechat/data-schemas';
import { CacheKeys, ViolationTypes, resolveTimePackRuntime } from 'librechat-data-provider';
import type { TTimePackRuntime } from 'librechat-data-provider';
import { cacheConfig, ioredisClient } from '~/cache';

const { USE_REDIS } = cacheConfig;

/** Lua: admit one seat for userId when under the global and per-user caps. */
const ACQUIRE_SCRIPT = `
local holdersKey = KEYS[1]
local cooldownKey = KEYS[2]
local userId = ARGV[1]
local maxSeats = tonumber(ARGV[2])
local maxPerUser = tonumber(ARGV[3])
local leaseTtl = tonumber(ARGV[4])
if redis.call('EXISTS', cooldownKey) == 1 then
  local ttl = redis.call('PTTL', cooldownKey)
  return {0, 'cooldown', ttl}
end
local held = redis.call('SISMEMBER', holdersKey, userId)
if held == 1 then
  return {0, 'held', 0}
end
local count = redis.call('SCARD', holdersKey)
if count >= maxSeats then
  return {0, 'full', count}
end
redis.call('SADD', holdersKey, userId)
redis.call('EXPIRE', holdersKey, leaseTtl)
return {1, 'ok', count + 1}
`;

const RELEASE_SCRIPT = `
local holdersKey = KEYS[1]
local userId = ARGV[1]
redis.call('SREM', holdersKey, userId)
local count = redis.call('SCARD', holdersKey)
if count <= 0 then
  redis.call('DEL', holdersKey)
  return 0
end
return count
`;

const FORCE_REST_SCRIPT = `
local holdersKey = KEYS[1]
local cooldownKey = KEYS[2]
local userId = ARGV[1]
local restSeconds = tonumber(ARGV[2])
local holdersTtl = tonumber(ARGV[3])
redis.call('SREM', holdersKey, userId)
redis.call('SETEX', cooldownKey, restSeconds, '1')
local count = redis.call('SCARD', holdersKey)
if count <= 0 then
  redis.call('DEL', holdersKey)
else
  redis.call('EXPIRE', holdersKey, holdersTtl)
end
return count
`;

const memoryHolders = new Set<string>();
const memoryCooldowns = new Map<string, number>();
const memoryMeters = new Map<string, { amount: number; expiresAt: number }>();

export type TimeSeatAcquireResult =
  | { allowed: true; pendingSeats: number; limit: number }
  | {
      allowed: false;
      reason: 'cooldown' | 'held' | 'full' | 'unavailable';
      pendingSeats: number;
      limit: number;
      cooldownMs?: number;
      holders?: string[];
    };

export type TimeSeatOversellCandidate = {
  userId: string;
  meteredCredits: number;
};

function holdersKey(): string {
  return `${CacheKeys.TIME_PACK_SEATS}:holders`;
}

function cooldownKey(userId: string): string {
  return `${CacheKeys.TIME_PACK_COOLDOWN}:${userId}`;
}

function meterKey(userId: string): string {
  return `${CacheKeys.TIME_PACK_METER}:${userId}`;
}

function leaseTtlSeconds(runtime: Required<TTimePackRuntime>): number {
  /** Long enough for a generation; renewed implicitly by settle/release. */
  return Math.max(runtime.restMinutes * 60, 30 * 60);
}

function pruneMemoryCooldowns(now: number): void {
  for (const [userId, until] of memoryCooldowns) {
    if (until <= now) {
      memoryCooldowns.delete(userId);
    }
  }
}

function pruneMemoryMeters(now: number): void {
  for (const [userId, entry] of memoryMeters) {
    if (entry.expiresAt <= now) {
      memoryMeters.delete(userId);
    }
  }
}

/** Current seat holders (Redis set or in-memory fallback). */
export async function listTimePackHolders(): Promise<string[]> {
  if (USE_REDIS && ioredisClient) {
    try {
      return await ioredisClient.smembers(holdersKey());
    } catch (error) {
      logger.error('[timeSeats] list holders failed', error);
      return [];
    }
  }
  return [...memoryHolders];
}

export async function getTimePackMeteredCredits(userId: string): Promise<number> {
  if (USE_REDIS && ioredisClient) {
    try {
      const raw = await ioredisClient.get(meterKey(userId));
      const amount = raw != null ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(amount) ? Math.max(0, amount) : 0;
    } catch (error) {
      logger.error('[timeSeats] read meter failed', error);
      return 0;
    }
  }
  pruneMemoryMeters(Date.now());
  return memoryMeters.get(userId)?.amount ?? 0;
}

/** Adds metered (not charged) credits to the rolling fairness window. */
export async function addTimePackMeteredCredits(
  userId: string,
  credits: number,
  runtime: Partial<TTimePackRuntime> | null | undefined,
): Promise<void> {
  if (!(credits > 0) || !userId) {
    return;
  }
  const resolved = resolveTimePackRuntime(runtime);
  const ttlSeconds = resolved.usageWindowHours * 3600;
  if (USE_REDIS && ioredisClient) {
    try {
      const key = meterKey(userId);
      const next = await ioredisClient.incrby(key, Math.ceil(credits));
      if (next === Math.ceil(credits)) {
        await ioredisClient.expire(key, ttlSeconds);
      }
    } catch (error) {
      logger.error('[timeSeats] meter increment failed', error);
    }
    return;
  }
  const now = Date.now();
  pruneMemoryMeters(now);
  const existing = memoryMeters.get(userId);
  memoryMeters.set(userId, {
    amount: (existing?.amount ?? 0) + Math.ceil(credits),
    expiresAt: now + ttlSeconds * 1000,
  });
}

export async function forceRestTimePackUser(
  userId: string,
  runtime: Partial<TTimePackRuntime> | null | undefined,
): Promise<void> {
  const resolved = resolveTimePackRuntime(runtime);
  const restSeconds = resolved.restMinutes * 60;
  const leaseTtl = leaseTtlSeconds(resolved);
  if (USE_REDIS && ioredisClient) {
    try {
      await ioredisClient.eval(
        FORCE_REST_SCRIPT,
        2,
        holdersKey(),
        cooldownKey(userId),
        userId,
        String(restSeconds),
        String(leaseTtl),
      );
    } catch (error) {
      logger.error('[timeSeats] force rest failed', error);
    }
    return;
  }
  memoryHolders.delete(userId);
  memoryCooldowns.set(userId, Date.now() + restSeconds * 1000);
}

/**
 * Tries to acquire a shared time-pack seat. Does not oversell by itself — callers run
 * {@link tryOversellTimePackSeat} when the result reason is `full`.
 */
export async function acquireTimePackSeat(
  userId: string,
  runtime: Partial<TTimePackRuntime> | null | undefined,
): Promise<TimeSeatAcquireResult> {
  const resolved = resolveTimePackRuntime(runtime);
  const limit = resolved.maxSeats;
  if (!userId) {
    return { allowed: false, reason: 'unavailable', pendingSeats: 0, limit };
  }

  if (USE_REDIS && ioredisClient) {
    try {
      const raw = (await ioredisClient.eval(
        ACQUIRE_SCRIPT,
        2,
        holdersKey(),
        cooldownKey(userId),
        userId,
        String(limit),
        String(resolved.maxSeatsPerUser),
        String(leaseTtlSeconds(resolved)),
      )) as [number, string, number];
      const [ok, reason, detail] = raw;
      if (ok === 1) {
        return { allowed: true, pendingSeats: Number(detail), limit };
      }
      if (reason === 'cooldown') {
        return {
          allowed: false,
          reason: 'cooldown',
          pendingSeats: 0,
          limit,
          cooldownMs: Math.max(0, Number(detail)),
        };
      }
      if (reason === 'held') {
        return { allowed: false, reason: 'held', pendingSeats: limit, limit };
      }
      const holders = await listTimePackHolders();
      return {
        allowed: false,
        reason: 'full',
        pendingSeats: Number(detail) || holders.length,
        limit,
        holders,
      };
    } catch (error) {
      logger.error('[timeSeats] acquire failed open', error);
      return { allowed: true, pendingSeats: 0, limit };
    }
  }

  const now = Date.now();
  pruneMemoryCooldowns(now);
  const cooldownUntil = memoryCooldowns.get(userId);
  if (cooldownUntil != null && cooldownUntil > now) {
    return {
      allowed: false,
      reason: 'cooldown',
      pendingSeats: memoryHolders.size,
      limit,
      cooldownMs: cooldownUntil - now,
    };
  }
  if (memoryHolders.has(userId)) {
    return { allowed: false, reason: 'held', pendingSeats: memoryHolders.size, limit };
  }
  if (memoryHolders.size >= limit) {
    return {
      allowed: false,
      reason: 'full',
      pendingSeats: memoryHolders.size,
      limit,
      holders: [...memoryHolders],
    };
  }
  memoryHolders.add(userId);
  return { allowed: true, pendingSeats: memoryHolders.size, limit };
}

export async function releaseTimePackSeat(userId: string): Promise<void> {
  if (!userId) {
    return;
  }
  if (USE_REDIS && ioredisClient) {
    try {
      await ioredisClient.eval(RELEASE_SCRIPT, 1, holdersKey(), userId);
    } catch (error) {
      logger.error('[timeSeats] release failed', error);
    }
    return;
  }
  memoryHolders.delete(userId);
}

/**
 * Among current holders, force-rest the heaviest user when they exceed the oversale threshold,
 * then admit the requester. Returns null when oversale is not possible.
 */
export async function tryOversellTimePackSeat(
  requesterId: string,
  runtime: Partial<TTimePackRuntime> | null | undefined,
  abortHolder: (userId: string) => Promise<void>,
): Promise<TimeSeatAcquireResult | null> {
  const resolved = resolveTimePackRuntime(runtime);
  const holders = await listTimePackHolders();
  if (holders.length === 0) {
    return acquireTimePackSeat(requesterId, runtime);
  }

  const ranked: TimeSeatOversellCandidate[] = [];
  for (const holderId of holders) {
    if (holderId === requesterId) {
      continue;
    }
    ranked.push({
      userId: holderId,
      meteredCredits: await getTimePackMeteredCredits(holderId),
    });
  }
  ranked.sort((a, b) => b.meteredCredits - a.meteredCredits);
  const heaviest = ranked[0];
  if (heaviest == null || heaviest.meteredCredits < resolved.oversellMinMeteredCredits) {
    return null;
  }

  await forceRestTimePackUser(heaviest.userId, runtime);
  try {
    await abortHolder(heaviest.userId);
  } catch (error) {
    logger.warn('[timeSeats] abort after force-rest failed', error);
  }
  return acquireTimePackSeat(requesterId, runtime);
}

export function timePackViolationType(
  reason: 'cooldown' | 'held' | 'full' | 'unavailable',
): ViolationTypes {
  return reason === 'cooldown' ? ViolationTypes.TIME_PACK_REST : ViolationTypes.TIME_PACK_BUSY;
}

/** Test-only: clear in-memory seat state. */
export function __resetTimePackSeatsForTests(): void {
  memoryHolders.clear();
  memoryCooldowns.clear();
  memoryMeters.clear();
}
