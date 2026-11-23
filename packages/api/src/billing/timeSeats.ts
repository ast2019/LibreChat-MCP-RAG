import { logger } from '@librechat/data-schemas';
import { CacheKeys, ViolationTypes, resolveTimePackRuntime } from 'librechat-data-provider';
import type { TTimePackRuntime } from 'librechat-data-provider';
import type { RedisScriptClient } from '~/cache/redisScript';
import { cacheConfig, ioredisClient } from '~/cache';
import { evalScript } from '~/cache/redisScript';

/**
 * Shared seat pool for time-pack Claude generations.
 *
 * Every admitted generation holds its own lease: a member of one sorted set scored by the
 * instant it expires. The member names the user, the generation (stream id) and its tenant, so
 * eviction can stop exactly that generation. Each script first drops expired members, so a
 * process that dies mid-generation frees its seat after `leaseSeconds`; a running generation
 * renews its lease (see {@link startTimeSeatHeartbeat}).
 *
 * All keys share the `{time_pack}` hash tag so the scripts stay on one Redis Cluster slot.
 */

type RuntimeInput = Partial<TTimePackRuntime> | null | undefined;
type Runtime = Required<TTimePackRuntime>;

export type TimeSeatRejectReason = 'cooldown' | 'held' | 'full' | 'unavailable';

/** One generation's seat: where it is stored and the sorted-set member that names it. */
export type TimeSeatLease = {
  store: 'redis' | 'memory';
  member: string;
  userId: string;
  leaseId: string;
  tenantId?: string;
};

/** A holder's generation that lost its seat to oversale and should be stopped. */
export type TimeSeatEvictedLease = {
  userId: string;
  leaseId: string;
  tenantId?: string;
};

export type TimeSeatAcquireResult =
  | {
      allowed: true;
      pendingSeats: number;
      limit: number;
      lease: TimeSeatLease;
      evicted: TimeSeatEvictedLease[];
    }
  | {
      allowed: false;
      reason: TimeSeatRejectReason;
      pendingSeats: number;
      limit: number;
      cooldownMs?: number;
    };

export type TimeSeatRequest = {
  userId: string;
  /** The generation's stream id; stored with the lease so oversale stops only it. */
  leaseId: string;
  tenantId?: string;
};

export type TimeSeatOversellCandidate = {
  userId: string;
  meteredCredits: number;
};

/** The Redis commands the pool runs; an ioredis client or cluster satisfies it. */
export type TimeSeatRedis = RedisScriptClient & {
  zrangebyscore: (key: string, min: string | number, max: string | number) => Promise<string[]>;
  mget: (...keys: string[]) => Promise<Array<string | null>>;
};

export interface TimeSeatPoolDeps {
  /** The Redis client, or null for the in-memory pool. Read on every call. */
  redis: () => TimeSeatRedis | null;
  now?: () => number;
}

export interface TimeSeatPool {
  /** Admits one generation, force-resting the heaviest holder when the pool is full. */
  acquire: (request: TimeSeatRequest, runtime: RuntimeInput) => Promise<TimeSeatAcquireResult>;
  /** Extends a held lease; false when it is gone (expired or evicted). */
  renew: (lease: TimeSeatLease, runtime: RuntimeInput) => Promise<boolean>;
  release: (lease: TimeSeatLease) => Promise<void>;
  addMeteredCredits: (userId: string, credits: number, runtime: RuntimeInput) => Promise<void>;
  getMeteredCredits: (userId: string) => Promise<number>;
  /** Users holding at least one live lease. */
  listHolders: () => Promise<string[]>;
  /** Test-only: clears the in-memory pool. */
  resetMemory: () => void;
}

const MEMBER_SEPARATOR = '|';

/** Lua shared by the admission scripts: prune, cooldown, per-user and global caps. */
const ADMIT_PRELUDE = `
local leases = KEYS[1]
local userId = ARGV[1]
local member = ARGV[2]
local now = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
local maxSeats = tonumber(ARGV[5])
local maxPerUser = tonumber(ARGV[6])
redis.call('ZREMRANGEBYSCORE', leases, '-inf', now)
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {0, 'cooldown', redis.call('PTTL', KEYS[2])}
end
local members = redis.call('ZRANGE', leases, 0, -1)
local function ownedBy(entry, owner)
  local prefix = owner .. '${MEMBER_SEPARATOR}'
  return string.sub(entry, 1, #prefix) == prefix
end
local mine = 0
for _, entry in ipairs(members) do
  if ownedBy(entry, userId) then
    mine = mine + 1
  end
end
if mine >= maxPerUser then
  return {0, 'held', #members}
end
local function admit(count)
  redis.call('ZADD', leases, now + leaseMs, member)
  local last = redis.call('ZRANGE', leases, -1, -1, 'WITHSCORES')
  redis.call('PEXPIRE', leases, math.max(1000, tonumber(last[2]) - now + 1000))
  return count + 1
end
`;

/** KEYS: leases, requester cooldown. ARGV: userId, member, now, leaseMs, maxSeats, maxPerUser. */
const ACQUIRE_SCRIPT = `${ADMIT_PRELUDE}
if #members >= maxSeats then
  return {0, 'full', #members}
end
return {1, 'ok', admit(#members)}
`;

/**
 * Admits the requester by force-resting `victimId` in one step, so no other request can take
 * the freed seat in between. Re-checks everything the caller ranked on: the pool is still full,
 * the victim still holds a lease and is still over the metered threshold.
 * KEYS: leases, requester cooldown, victim cooldown, victim meter.
 * ARGV: userId, member, now, leaseMs, maxSeats, maxPerUser, victimId, restMs, minMetered.
 */
const EVICT_ADMIT_SCRIPT = `${ADMIT_PRELUDE}
if #members < maxSeats then
  return {1, 'ok', admit(#members)}
end
local victimId = ARGV[7]
if victimId == userId then
  return {0, 'full', #members}
end
local metered = tonumber(redis.call('GET', KEYS[4]) or '0') or 0
if metered < tonumber(ARGV[9]) then
  return {0, 'full', #members}
end
local evicted = {}
for _, entry in ipairs(members) do
  if ownedBy(entry, victimId) then
    redis.call('ZREM', leases, entry)
    table.insert(evicted, entry)
  end
end
if #evicted == 0 then
  return {0, 'full', #members}
end
redis.call('SET', KEYS[3], '1', 'PX', tonumber(ARGV[8]))
local result = {1, 'evicted', admit(#members - #evicted)}
for _, entry in ipairs(evicted) do
  table.insert(result, entry)
end
return result
`;

/** KEYS: leases. ARGV: member, now, leaseMs. */
const RENEW_SCRIPT = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
local now = tonumber(ARGV[2])
if not score or tonumber(score) <= now then
  redis.call('ZREM', KEYS[1], ARGV[1])
  return 0
end
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[3]), ARGV[1])
local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(1000, tonumber(last[2]) - now + 1000))
return 1
`;

/** KEYS: leases. ARGV: member. */
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`;

/**
 * Fixed fairness window: it opens at the first metered usage and lasts `usageWindowHours`.
 * The increment and the expiry are one step, and a key found without an expiry gets one.
 * KEYS: meter. ARGV: credits, windowMs.
 */
const METER_SCRIPT = `
local total = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return total
`;

function leasesKey(): string {
  return `${CacheKeys.TIME_PACK_SEATS}:{time_pack}:leases`;
}

function cooldownKey(userId: string): string {
  return `${CacheKeys.TIME_PACK_COOLDOWN}:{time_pack}:${userId}`;
}

function meterKey(userId: string): string {
  return `${CacheKeys.TIME_PACK_METER}:{time_pack}:${userId}`;
}

function toMember({ userId, leaseId, tenantId }: TimeSeatRequest): string {
  return [userId, leaseId, tenantId ?? ''].join(MEMBER_SEPARATOR);
}

function parseMember(member: string): TimeSeatEvictedLease {
  const [userId, leaseId = '', tenantId = ''] = member.split(MEMBER_SEPARATOR);
  return { userId, leaseId, ...(tenantId !== '' && { tenantId }) };
}

function isValidRequest(request: TimeSeatRequest): boolean {
  const parts = [request.userId, request.leaseId, request.tenantId ?? ''];
  return (
    request.userId !== '' &&
    request.leaseId !== '' &&
    parts.every((part) => !part.includes(MEMBER_SEPARATOR))
  );
}

type ScriptReply = [number, string, number, ...string[]];

/** Creates a seat pool on the given Redis client, with an in-memory pool as its fallback. */
export function createTimeSeatPool(deps: TimeSeatPoolDeps): TimeSeatPool {
  const now = deps.now ?? (() => Date.now());
  const memoryLeases = new Map<string, number>();
  const memoryCooldowns = new Map<string, number>();
  const memoryMeters = new Map<string, { amount: number; expiresAt: number }>();

  function pruneMemory(at: number): void {
    for (const [member, expiresAt] of memoryLeases) {
      if (expiresAt <= at) {
        memoryLeases.delete(member);
      }
    }
    for (const [userId, until] of memoryCooldowns) {
      if (until <= at) {
        memoryCooldowns.delete(userId);
      }
    }
    for (const [userId, entry] of memoryMeters) {
      if (entry.expiresAt <= at) {
        memoryMeters.delete(userId);
      }
    }
  }

  function memoryOwned(userId: string): string[] {
    return [...memoryLeases.keys()].filter((member) => parseMember(member).userId === userId);
  }

  function rejected(
    reason: TimeSeatRejectReason,
    pendingSeats: number,
    limit: number,
    cooldownMs?: number,
  ): TimeSeatAcquireResult {
    return {
      allowed: false,
      reason,
      pendingSeats,
      limit,
      ...(cooldownMs != null && { cooldownMs: Math.max(0, cooldownMs) }),
    };
  }

  function acquireMemory(request: TimeSeatRequest, runtime: Runtime): TimeSeatAcquireResult {
    const at = now();
    pruneMemory(at);
    const limit = runtime.maxSeats;
    const cooldownUntil = memoryCooldowns.get(request.userId);
    if (cooldownUntil != null) {
      return rejected('cooldown', memoryLeases.size, limit, cooldownUntil - at);
    }
    if (memoryOwned(request.userId).length >= runtime.maxSeatsPerUser) {
      return rejected('held', memoryLeases.size, limit);
    }
    const evicted: TimeSeatEvictedLease[] = [];
    if (memoryLeases.size >= limit) {
      const victim = rankHolders(
        [...new Set([...memoryLeases.keys()].map((member) => parseMember(member).userId))],
        request.userId,
        (userId) => memoryMeters.get(userId)?.amount ?? 0,
      );
      if (victim == null || victim.meteredCredits < runtime.oversellMinMeteredCredits) {
        return rejected('full', memoryLeases.size, limit);
      }
      for (const member of memoryOwned(victim.userId)) {
        memoryLeases.delete(member);
        evicted.push(parseMember(member));
      }
      memoryCooldowns.set(victim.userId, at + runtime.restMinutes * 60_000);
    }
    const member = toMember(request);
    memoryLeases.set(member, at + runtime.leaseSeconds * 1000);
    return {
      allowed: true,
      pendingSeats: memoryLeases.size,
      limit,
      lease: { store: 'memory', member, ...request },
      evicted,
    };
  }

  function fromReply(
    reply: ScriptReply,
    request: TimeSeatRequest,
    member: string,
    limit: number,
  ): TimeSeatAcquireResult {
    const [ok, reason, detail, ...evicted] = reply;
    if (Number(ok) === 1) {
      return {
        allowed: true,
        pendingSeats: Number(detail),
        limit,
        lease: { store: 'redis', member, ...request },
        evicted: evicted.map(parseMember),
      };
    }
    if (reason === 'cooldown') {
      return rejected('cooldown', 0, limit, Number(detail));
    }
    return rejected(reason === 'held' ? 'held' : 'full', Number(detail), limit);
  }

  async function acquireRedis(
    redis: TimeSeatRedis,
    request: TimeSeatRequest,
    runtime: Runtime,
  ): Promise<TimeSeatAcquireResult> {
    const member = toMember(request);
    const at = now();
    const admitArgs = [
      request.userId,
      member,
      String(at),
      String(runtime.leaseSeconds * 1000),
      String(runtime.maxSeats),
      String(runtime.maxSeatsPerUser),
    ];
    const first = fromReply(
      (await evalScript(
        redis,
        ACQUIRE_SCRIPT,
        2,
        leasesKey(),
        cooldownKey(request.userId),
        ...admitArgs,
      )) as ScriptReply,
      request,
      member,
      runtime.maxSeats,
    );
    if (first.allowed || first.reason !== 'full') {
      return first;
    }
    const holders = await listRedisHolders(redis, at);
    const meters = await readRedisMeters(redis, holders);
    const victim = rankHolders(holders, request.userId, (userId) => meters.get(userId) ?? 0);
    if (victim == null || victim.meteredCredits < runtime.oversellMinMeteredCredits) {
      return first;
    }
    return fromReply(
      (await evalScript(
        redis,
        EVICT_ADMIT_SCRIPT,
        4,
        leasesKey(),
        cooldownKey(request.userId),
        cooldownKey(victim.userId),
        meterKey(victim.userId),
        ...admitArgs,
        victim.userId,
        String(runtime.restMinutes * 60_000),
        String(runtime.oversellMinMeteredCredits),
      )) as ScriptReply,
      request,
      member,
      runtime.maxSeats,
    );
  }

  async function listRedisHolders(redis: TimeSeatRedis, at: number): Promise<string[]> {
    const members = await redis.zrangebyscore(leasesKey(), `(${at}`, '+inf');
    return [...new Set(members.map((member) => parseMember(member).userId))];
  }

  async function readRedisMeters(
    redis: TimeSeatRedis,
    userIds: string[],
  ): Promise<Map<string, number>> {
    const meters = new Map<string, number>();
    if (userIds.length === 0) {
      return meters;
    }
    const values = await redis.mget(...userIds.map(meterKey));
    userIds.forEach((userId, index) => {
      const amount = Number.parseInt(values[index] ?? '0', 10);
      meters.set(userId, Number.isFinite(amount) ? Math.max(0, amount) : 0);
    });
    return meters;
  }

  return {
    async acquire(request, runtimeInput) {
      const runtime = resolveTimePackRuntime(runtimeInput);
      if (!isValidRequest(request)) {
        return rejected('unavailable', 0, runtime.maxSeats);
      }
      const redis = deps.redis();
      if (redis == null) {
        return acquireMemory(request, runtime);
      }
      try {
        return await acquireRedis(redis, request, runtime);
      } catch (error) {
        if (runtime.redisFailure === 'reject') {
          logger.error('[timeSeats] acquire failed; rejecting (redisFailure: reject)', error);
          return rejected('unavailable', 0, runtime.maxSeats);
        }
        logger.error('[timeSeats] acquire failed; using the in-memory pool', error);
        return acquireMemory(request, runtime);
      }
    },

    async renew(lease, runtimeInput) {
      const runtime = resolveTimePackRuntime(runtimeInput);
      const at = now();
      const redis = lease.store === 'redis' ? deps.redis() : null;
      if (lease.store === 'memory' || redis == null) {
        const expiresAt = memoryLeases.get(lease.member);
        if (expiresAt == null || expiresAt <= at) {
          memoryLeases.delete(lease.member);
          return false;
        }
        memoryLeases.set(lease.member, at + runtime.leaseSeconds * 1000);
        return true;
      }
      const renewed = await evalScript(
        redis,
        RENEW_SCRIPT,
        1,
        leasesKey(),
        lease.member,
        String(at),
        String(runtime.leaseSeconds * 1000),
      );
      return Number(renewed) === 1;
    },

    async release(lease) {
      const redis = lease.store === 'redis' ? deps.redis() : null;
      if (lease.store === 'memory' || redis == null) {
        memoryLeases.delete(lease.member);
        return;
      }
      try {
        await evalScript(redis, RELEASE_SCRIPT, 1, leasesKey(), lease.member);
      } catch (error) {
        /** The lease still expires on its own after `leaseSeconds`. */
        logger.error('[timeSeats] release failed; the lease will expire', error);
      }
    },

    async addMeteredCredits(userId, credits, runtimeInput) {
      if (!(credits > 0) || !userId) {
        return;
      }
      const runtime = resolveTimePackRuntime(runtimeInput);
      const amount = Math.ceil(credits);
      const windowMs = runtime.usageWindowHours * 3_600_000;
      const redis = deps.redis();
      if (redis != null) {
        try {
          await evalScript(
            redis,
            METER_SCRIPT,
            1,
            meterKey(userId),
            String(amount),
            String(windowMs),
          );
        } catch (error) {
          logger.error('[timeSeats] meter increment failed', error);
        }
        return;
      }
      const at = now();
      pruneMemory(at);
      const existing = memoryMeters.get(userId);
      memoryMeters.set(userId, {
        amount: (existing?.amount ?? 0) + amount,
        expiresAt: existing?.expiresAt ?? at + windowMs,
      });
    },

    async getMeteredCredits(userId) {
      const redis = deps.redis();
      if (redis != null) {
        return (await readRedisMeters(redis, [userId])).get(userId) ?? 0;
      }
      pruneMemory(now());
      return memoryMeters.get(userId)?.amount ?? 0;
    },

    async listHolders() {
      const redis = deps.redis();
      if (redis != null) {
        return listRedisHolders(redis, now());
      }
      pruneMemory(now());
      return [...new Set([...memoryLeases.keys()].map((member) => parseMember(member).userId))];
    },

    resetMemory() {
      memoryLeases.clear();
      memoryCooldowns.clear();
      memoryMeters.clear();
    },
  };
}

/** The heaviest metered holder other than the requester, or null when there is none. */
function rankHolders(
  holders: string[],
  requesterId: string,
  meteredCredits: (userId: string) => number,
): TimeSeatOversellCandidate | null {
  let heaviest: TimeSeatOversellCandidate | null = null;
  for (const userId of holders) {
    if (userId === requesterId) {
      continue;
    }
    const candidate = { userId, meteredCredits: meteredCredits(userId) };
    if (heaviest == null || candidate.meteredCredits > heaviest.meteredCredits) {
      heaviest = candidate;
    }
  }
  return heaviest;
}

let defaultPool: TimeSeatPool | null = null;

/** The process pool on the app's Redis client (`USE_REDIS`), or in memory without it. */
export function getTimeSeatPool(): TimeSeatPool {
  if (defaultPool == null) {
    defaultPool = createTimeSeatPool({
      redis: () => (cacheConfig.USE_REDIS && ioredisClient ? ioredisClient : null),
    });
  }
  return defaultPool;
}

/** Adds metered (not charged) credits to the user's fixed fairness window. */
export async function addTimePackMeteredCredits(
  userId: string,
  credits: number,
  runtime: RuntimeInput,
): Promise<void> {
  await getTimeSeatPool().addMeteredCredits(userId, credits, runtime);
}

export interface TimeSeatHeartbeat {
  stop: () => void;
}

/**
 * Renews `lease` every third of `leaseSeconds` while a generation runs. Stops by itself once the
 * lease is gone (evicted or expired); a failed renewal is logged and retried on the next tick.
 */
export function startTimeSeatHeartbeat(
  pool: TimeSeatPool,
  lease: TimeSeatLease,
  runtime: RuntimeInput,
): TimeSeatHeartbeat {
  const { leaseSeconds } = resolveTimePackRuntime(runtime);
  const timer = setInterval(
    () => {
      pool.renew(lease, runtime).then(
        (held) => {
          if (!held) {
            clearInterval(timer);
          }
        },
        (error: unknown) => logger.warn('[timeSeats] lease renewal failed', error),
      );
    },
    Math.max(1000, Math.floor((leaseSeconds * 1000) / 3)),
  );
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export function timePackViolationType(reason: TimeSeatRejectReason): ViolationTypes {
  return reason === 'cooldown' ? ViolationTypes.TIME_PACK_REST : ViolationTypes.TIME_PACK_BUSY;
}

/** Test-only: clear the default pool's in-memory state. */
export function __resetTimePackSeatsForTests(): void {
  getTimeSeatPool().resetMemory();
}
