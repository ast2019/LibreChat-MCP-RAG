import { logger } from '@librechat/data-schemas';
import { CacheKeys, resolveTimePackRuntime } from 'librechat-data-provider';
import type { TTimePackRuntime } from 'librechat-data-provider';
import type { RedisScriptClient } from '~/cache/redisScript';
import { cacheConfig, ioredisClient } from '~/cache';
import { evalScript } from '~/cache/redisScript';

/**
 * The gateway's request ceiling for the whole ClaudeTime key, shared by every user of the plan.
 *
 * The upstream limit belongs to the key, not to a person: 60 requests a minute for the account
 * as a whole. Enforcing it per user would let four users send four times the allowance and
 * earn a gateway-side 429 for all of them, so the counter is global and each user may take
 * only a share of it. A request that finds the shared road full waits for a slot instead of
 * being refused, because the gateway queues its own traffic and a short wait here turns a
 * refusal into a slightly slower answer.
 *
 * All keys share the `{time_pack}` hash tag so the scripts stay on one Redis Cluster slot.
 */

type RuntimeInput = Partial<TTimePackRuntime> | null | undefined;
type Runtime = Required<TTimePackRuntime>;

export type TimePackRateRejection = 'user_share' | 'global_full';

export type TimePackRateResult =
  | { allowed: true; globalCount: number; userCount: number; limit: number }
  | {
      allowed: false;
      reason: TimePackRateRejection;
      globalCount: number;
      userCount: number;
      limit: number;
      /** How long the caller may wait for capacity, in milliseconds. */
      retryAfterMs: number;
    };

export interface TimePackRatePoolDeps {
  /** The Redis client, or null for the in-memory pool. Read on every call. */
  redis: () => RedisScriptClient | null;
  now?: () => number;
}

export interface TimePackRatePool {
  /** Takes one slot from the shared allowance when both the global cap and the user share allow. */
  acquire: (userId: string, runtime: RuntimeInput) => Promise<TimePackRateResult>;
  /** The number of requests taken in the current window, globally and for one user. */
  read: (userId: string) => Promise<{ globalCount: number; userCount: number }>;
  /** The clock the pool reads, so a caller shares one notion of time with it. */
  now: () => number;
  /** Test-only: clears the in-memory pool. */
  resetMemory: () => void;
}

const WINDOW_MS = 60_000;

/**
 * The minute bucket a request belongs to. The shared counter and every user's counter live
 * in the same bucket, so one window holds one minute of traffic for the whole key: a user's
 * share cannot straddle two global windows and let more than the ceiling through.
 */
function windowBucket(at: number): number {
  return Math.floor(at / WINDOW_MS);
}

/** The end of the bucket, so a caller knows how long until the window turns over. */
function windowEndMs(bucket: number): number {
  return (bucket + 1) * WINDOW_MS;
}

/**
 * Counts one request against the shared allowance and the requester's own share, in one step.
 *
 * The global counter and the user counter live in the same script so the window is one atomic
 * action. A request over either limit is rolled back on both counters: a refused request must
 * not consume the shared capacity that other users are waiting for.
 *
 * KEYS: global counter, user counter. ARGV: windowMs, globalLimit, userLimit.
 * Returns: { globalCount, userCount, allowed }.
 */
const ACQUIRE_SCRIPT = `
local globalKey = KEYS[1]
local userKey = KEYS[2]
local windowMs = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local userLimit = tonumber(ARGV[3])
local globalCount = redis.call('INCR', globalKey)
if redis.call('PTTL', globalKey) < 0 then
  redis.call('PEXPIRE', globalKey, windowMs)
end
local userCount = redis.call('INCR', userKey)
if redis.call('PTTL', userKey) < 0 then
  redis.call('PEXPIRE', userKey, windowMs)
end
local overGlobal = globalCount > globalLimit
local overUser = userCount > userLimit
if overGlobal or overUser then
  redis.call('DECR', globalKey)
  redis.call('DECR', userKey)
  return {globalCount, userCount, 0}
end
return {globalCount, userCount, 1}
`;

function globalKey(bucket: number): string {
  return `${CacheKeys.TIME_PACK_RATE}:{time_pack}:global:${bucket}`;
}

function userKey(userId: string, bucket: number): string {
  return `${CacheKeys.TIME_PACK_RATE}:{time_pack}:user:${userId}:${bucket}`;
}

/** The counters of the shared allowance, for the shared and the requester's own share. */
export function createTimePackRatePool(deps: TimePackRatePoolDeps): TimePackRatePool {
  const now = deps.now ?? (() => Date.now());
  const memoryGlobal = new Map<number, number>();
  const memoryUsers = new Map<string, number>();

  function userMemoryKey(userId: string, bucket: number): string {
    return `${userId}:${bucket}`;
  }

  function acquireMemory(userId: string, runtime: Runtime): TimePackRateResult {
    const at = now();
    const bucket = windowBucket(at);
    const globalCount = (memoryGlobal.get(bucket) ?? 0) + 1;
    const userCount = (memoryUsers.get(userMemoryKey(userId, bucket)) ?? 0) + 1;
    memoryGlobal.set(bucket, globalCount);
    memoryUsers.set(userMemoryKey(userId, bucket), userCount);

    const overGlobal = globalCount > runtime.requestsPerMinute;
    const overUser = userCount > runtime.userSharePerMinute;
    if (overGlobal || overUser) {
      /** A refused request must not consume the shared capacity, on either counter. */
      memoryGlobal.set(bucket, globalCount - 1);
      memoryUsers.set(userMemoryKey(userId, bucket), userCount - 1);
      return {
        allowed: false,
        reason: overGlobal ? 'global_full' : 'user_share',
        globalCount: globalCount - 1,
        userCount: userCount - 1,
        limit: runtime.requestsPerMinute,
        retryAfterMs: Math.max(0, windowEndMs(bucket) - at),
      };
    }
    return {
      allowed: true,
      globalCount,
      userCount,
      limit: runtime.requestsPerMinute,
    };
  }

  async function acquireRedis(
    redis: RedisScriptClient,
    userId: string,
    runtime: Runtime,
  ): Promise<TimePackRateResult> {
    const at = now();
    const bucket = windowBucket(at);
    const reply = (await evalScript(
      redis,
      ACQUIRE_SCRIPT,
      2,
      globalKey(bucket),
      userKey(userId, bucket),
      String(WINDOW_MS),
      String(runtime.requestsPerMinute),
      String(runtime.userSharePerMinute),
    )) as [number, number, number];
    const [globalCount, userCount, allowed] = reply;
    if (Number(allowed) === 1) {
      return {
        allowed: true,
        globalCount: Number(globalCount),
        userCount: Number(userCount),
        limit: runtime.requestsPerMinute,
      };
    }
    /** The script rolled both counters back; the reply still holds the pre-rollback counts. */
    const overGlobal = Number(globalCount) > runtime.requestsPerMinute;
    return {
      allowed: false,
      reason: overGlobal ? 'global_full' : 'user_share',
      globalCount: Number(globalCount) - 1,
      userCount: Number(userCount) - 1,
      limit: runtime.requestsPerMinute,
      retryAfterMs: Math.max(0, windowEndMs(bucket) - at),
    };
  }

  return {
    async acquire(userId, runtimeInput) {
      const runtime = resolveTimePackRuntime(runtimeInput);
      if (!userId) {
        return {
          allowed: true,
          globalCount: 0,
          userCount: 0,
          limit: runtime.requestsPerMinute,
        };
      }
      const redis = deps.redis();
      if (redis == null) {
        return acquireMemory(userId, runtime);
      }
      try {
        return await acquireRedis(redis, userId, runtime);
      } catch (error) {
        /**
         * A Redis outage must not take the plan down: the shared counter is a courtesy toward
         * the gateway, not the plan's access control. The seat pool still enforces the plan's
         * own limits, so the request proceeds and the gateway answers with its own 429.
         */
        logger.error('[timeRate] acquire failed; allowing the request', error);
        return {
          allowed: true,
          globalCount: 0,
          userCount: 0,
          limit: runtime.requestsPerMinute,
        };
      }
    },

    async read(userId) {
      const bucket = windowBucket(now());
      const redis = deps.redis();
      if (redis == null) {
        return {
          globalCount: memoryGlobal.get(bucket) ?? 0,
          userCount: memoryUsers.get(userMemoryKey(userId, bucket)) ?? 0,
        };
      }
      try {
        const values = await (
          redis as RedisScriptClient & {
            mget: (...keys: string[]) => Promise<Array<string | null>>;
          }
        ).mget(globalKey(bucket), userKey(userId, bucket));
        const toCount = (value: string | null | undefined): number => {
          const parsed = Number.parseInt(value ?? '0', 10);
          return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        };
        return { globalCount: toCount(values[0]), userCount: toCount(values[1]) };
      } catch (error) {
        logger.error('[timeRate] read failed', error);
        return { globalCount: 0, userCount: 0 };
      }
    },

    resetMemory() {
      memoryGlobal.clear();
      memoryUsers.clear();
    },

    now,
  };
}

let defaultPool: TimePackRatePool | null = null;

/** The process pool on the app's Redis client (`USE_REDIS`), or in memory without it. */
export function getTimePackRatePool(): TimePackRatePool {
  if (defaultPool == null) {
    defaultPool = createTimePackRatePool({
      redis: () => (cacheConfig.USE_REDIS && ioredisClient ? ioredisClient : null),
    });
  }
  return defaultPool;
}

/**
 * Takes one slot of the shared allowance, waiting for capacity when the road is full.
 *
 * The wait is bounded by `rateWaitMs`: the gateway's own queue is short, so waiting for it is
 * better than refusing, but a request must not hang forever when the allowance stays full.
 * The shared allowance frees up when the minute window turns over, so a request that would
 * still be waiting past its own deadline is refused at once instead of being held for a
 * slot it cannot get; the refusal carries the time left in the window.
 */
export async function acquireTimePackRateSlot({
  userId,
  runtime,
  pool = getTimePackRatePool(),
  sleep = defaultSleep,
}: {
  userId: string;
  runtime?: RuntimeInput;
  pool?: TimePackRatePool;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TimePackRateResult> {
  const resolved = resolveTimePackRuntime(runtime);
  const deadline = pool.now() + resolved.rateWaitMs;
  let result = await pool.acquire(userId, resolved);
  while (!result.allowed && result.reason === 'global_full') {
    const remaining = deadline - pool.now();
    if (remaining <= 0) {
      break;
    }
    /** Capacity returns when the window turns over; past the deadline that is too late. */
    if (result.retryAfterMs > remaining) {
      break;
    }
    await sleep(Math.min(250, remaining));
    result = await pool.acquire(userId, resolved);
  }
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test-only: clear the default pool's in-memory state. */
export function __resetTimePackRateForTests(): void {
  getTimePackRatePool().resetMemory();
}
