import { logger } from '@librechat/data-schemas';
import { CacheKeys, ViolationTypes, resolveTimePackRuntime } from 'librechat-data-provider';
import type { TTimePackRuntime } from 'librechat-data-provider';

/** Minimal Redis surface the seat pool needs (eval + hash/string ops). */
export type TimeSeatRedisClient = {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  get(key: string): Promise<string | null>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

export type TimeSeatServiceDeps = {
  useRedis: boolean;
  redis: TimeSeatRedisClient | null;
};

/**
 * Lua: admit one seat when under global and per-user caps.
 * KEYS[1]=counts hash (userId -> seat count), KEYS[2]=cooldown, KEYS[3]=total counter
 */
const ACQUIRE_SCRIPT = `
local countsKey = KEYS[1]
local cooldownKey = KEYS[2]
local totalKey = KEYS[3]
local userId = ARGV[1]
local maxSeats = tonumber(ARGV[2])
local maxPerUser = tonumber(ARGV[3])
local leaseTtl = tonumber(ARGV[4])
if redis.call('EXISTS', cooldownKey) == 1 then
  local ttl = redis.call('PTTL', cooldownKey)
  return {0, 'cooldown', ttl}
end
local held = tonumber(redis.call('HGET', countsKey, userId) or '0')
if held >= maxPerUser then
  return {0, 'held', held}
end
local total = tonumber(redis.call('GET', totalKey) or '0')
if total >= maxSeats then
  return {0, 'full', total}
end
local nextHeld = redis.call('HINCRBY', countsKey, userId, 1)
local nextTotal = redis.call('INCR', totalKey)
redis.call('EXPIRE', countsKey, leaseTtl)
redis.call('EXPIRE', totalKey, leaseTtl)
return {1, 'ok', nextTotal, nextHeld}
`;

const RELEASE_SCRIPT = `
local countsKey = KEYS[1]
local totalKey = KEYS[2]
local userId = ARGV[1]
local held = tonumber(redis.call('HGET', countsKey, userId) or '0')
if held <= 0 then
  local total = tonumber(redis.call('GET', totalKey) or '0')
  return total
end
if held <= 1 then
  redis.call('HDEL', countsKey, userId)
else
  redis.call('HINCRBY', countsKey, userId, -1)
end
local total = redis.call('DECR', totalKey)
if total <= 0 then
  redis.call('DEL', totalKey)
  if redis.call('HLEN', countsKey) == 0 then
    redis.call('DEL', countsKey)
  end
  return 0
end
return total
`;

const FORCE_REST_SCRIPT = `
local countsKey = KEYS[1]
local cooldownKey = KEYS[2]
local totalKey = KEYS[3]
local userId = ARGV[1]
local restSeconds = tonumber(ARGV[2])
local holdersTtl = tonumber(ARGV[3])
local held = tonumber(redis.call('HGET', countsKey, userId) or '0')
redis.call('HDEL', countsKey, userId)
redis.call('SETEX', cooldownKey, restSeconds, '1')
if held > 0 then
  local total = tonumber(redis.call('GET', totalKey) or '0')
  local nextTotal = total - held
  if nextTotal <= 0 then
    redis.call('DEL', totalKey)
  else
    redis.call('SET', totalKey, nextTotal)
    redis.call('EXPIRE', totalKey, holdersTtl)
  end
end
if redis.call('HLEN', countsKey) == 0 then
  redis.call('DEL', countsKey)
else
  redis.call('EXPIRE', countsKey, holdersTtl)
end
local total = tonumber(redis.call('GET', totalKey) or '0')
return total
`;

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

export type TimeSeatService = {
  listHolders: () => Promise<string[]>;
  getMeteredCredits: (userId: string) => Promise<number>;
  addMeteredCredits: (
    userId: string,
    credits: number,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ) => Promise<void>;
  forceRest: (
    userId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ) => Promise<void>;
  acquire: (
    userId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ) => Promise<TimeSeatAcquireResult>;
  release: (userId: string) => Promise<void>;
  tryOversell: (
    requesterId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
    abortHolder: (userId: string) => Promise<void>,
  ) => Promise<TimeSeatAcquireResult | null>;
  /** Test-only: clear in-memory seat state. */
  resetForTests: () => void;
};

function holdersCountsKey(): string {
  return `${CacheKeys.TIME_PACK_SEATS}:counts`;
}

function holdersTotalKey(): string {
  return `${CacheKeys.TIME_PACK_SEATS}:total`;
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

/**
 * Shared Claude time-pack seat pool. Callers supply Redis (or disable it) instead of
 * reaching for the app cache singleton.
 */
export function createTimeSeatService(deps: TimeSeatServiceDeps): TimeSeatService {
  const memoryCounts = new Map<string, number>();
  const memoryCooldowns = new Map<string, number>();
  const memoryMeters = new Map<string, { amount: number; expiresAt: number }>();

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

  function memoryTotal(): number {
    let total = 0;
    for (const count of memoryCounts.values()) {
      total += count;
    }
    return total;
  }

  async function listHolders(): Promise<string[]> {
    if (deps.useRedis && deps.redis) {
      try {
        const counts = await deps.redis.hgetall(holdersCountsKey());
        return Object.keys(counts).filter((userId) => Number.parseInt(counts[userId] ?? '0', 10) > 0);
      } catch (error) {
        logger.error('[timeSeats] list holders failed', error);
        return [];
      }
    }
    return [...memoryCounts.keys()].filter((userId) => (memoryCounts.get(userId) ?? 0) > 0);
  }

  async function getMeteredCredits(userId: string): Promise<number> {
    if (deps.useRedis && deps.redis) {
      try {
        const raw = await deps.redis.get(meterKey(userId));
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

  async function addMeteredCredits(
    userId: string,
    credits: number,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ): Promise<void> {
    if (!(credits > 0) || !userId) {
      return;
    }
    const resolved = resolveTimePackRuntime(runtime);
    const ttlSeconds = resolved.usageWindowHours * 3600;
    if (deps.useRedis && deps.redis) {
      try {
        const key = meterKey(userId);
        const next = await deps.redis.incrby(key, Math.ceil(credits));
        if (next === Math.ceil(credits)) {
          await deps.redis.expire(key, ttlSeconds);
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

  async function forceRest(
    userId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ): Promise<void> {
    const resolved = resolveTimePackRuntime(runtime);
    const restSeconds = resolved.restMinutes * 60;
    const leaseTtl = leaseTtlSeconds(resolved);
    if (deps.useRedis && deps.redis) {
      try {
        await deps.redis.eval(
          FORCE_REST_SCRIPT,
          3,
          holdersCountsKey(),
          cooldownKey(userId),
          holdersTotalKey(),
          userId,
          String(restSeconds),
          String(leaseTtl),
        );
      } catch (error) {
        logger.error('[timeSeats] force rest failed', error);
      }
      return;
    }
    memoryCounts.delete(userId);
    memoryCooldowns.set(userId, Date.now() + restSeconds * 1000);
  }

  async function acquire(
    userId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
  ): Promise<TimeSeatAcquireResult> {
    const resolved = resolveTimePackRuntime(runtime);
    const limit = resolved.maxSeats;
    if (!userId) {
      return { allowed: false, reason: 'unavailable', pendingSeats: 0, limit };
    }

    if (deps.useRedis && deps.redis) {
      try {
        const raw = (await deps.redis.eval(
          ACQUIRE_SCRIPT,
          3,
          holdersCountsKey(),
          cooldownKey(userId),
          holdersTotalKey(),
          userId,
          String(limit),
          String(resolved.maxSeatsPerUser),
          String(leaseTtlSeconds(resolved)),
        )) as [number, string, number, number?];
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
        const holders = await listHolders();
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
        pendingSeats: memoryTotal(),
        limit,
        cooldownMs: cooldownUntil - now,
      };
    }
    const held = memoryCounts.get(userId) ?? 0;
    if (held >= resolved.maxSeatsPerUser) {
      return { allowed: false, reason: 'held', pendingSeats: memoryTotal(), limit };
    }
    if (memoryTotal() >= limit) {
      return {
        allowed: false,
        reason: 'full',
        pendingSeats: memoryTotal(),
        limit,
        holders: await listHolders(),
      };
    }
    memoryCounts.set(userId, held + 1);
    return { allowed: true, pendingSeats: memoryTotal(), limit };
  }

  async function release(userId: string): Promise<void> {
    if (!userId) {
      return;
    }
    if (deps.useRedis && deps.redis) {
      try {
        await deps.redis.eval(RELEASE_SCRIPT, 2, holdersCountsKey(), holdersTotalKey(), userId);
      } catch (error) {
        logger.error('[timeSeats] release failed', error);
      }
      return;
    }
    const held = memoryCounts.get(userId) ?? 0;
    if (held <= 1) {
      memoryCounts.delete(userId);
    } else {
      memoryCounts.set(userId, held - 1);
    }
  }

  async function tryOversell(
    requesterId: string,
    runtime: Partial<TTimePackRuntime> | null | undefined,
    abortHolder: (userId: string) => Promise<void>,
  ): Promise<TimeSeatAcquireResult | null> {
    const resolved = resolveTimePackRuntime(runtime);
    const holders = await listHolders();
    if (holders.length === 0) {
      return acquire(requesterId, runtime);
    }

    const ranked: TimeSeatOversellCandidate[] = [];
    for (const holderId of holders) {
      if (holderId === requesterId) {
        continue;
      }
      ranked.push({
        userId: holderId,
        meteredCredits: await getMeteredCredits(holderId),
      });
    }
    ranked.sort((a, b) => b.meteredCredits - a.meteredCredits);
    const heaviest = ranked[0];
    if (heaviest == null || heaviest.meteredCredits < resolved.oversellMinMeteredCredits) {
      return null;
    }

    await forceRest(heaviest.userId, runtime);
    try {
      await abortHolder(heaviest.userId);
    } catch (error) {
      logger.warn('[timeSeats] abort after force-rest failed', error);
    }
    return acquire(requesterId, runtime);
  }

  return {
    listHolders,
    getMeteredCredits,
    addMeteredCredits,
    forceRest,
    acquire,
    release,
    tryOversell,
    resetForTests: () => {
      memoryCounts.clear();
      memoryCooldowns.clear();
      memoryMeters.clear();
    },
  };
}

export function timePackViolationType(
  reason: 'cooldown' | 'held' | 'full' | 'unavailable',
): ViolationTypes {
  return reason === 'cooldown' ? ViolationTypes.TIME_PACK_REST : ViolationTypes.TIME_PACK_BUSY;
}
