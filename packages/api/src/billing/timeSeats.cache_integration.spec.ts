import Redis from 'ioredis';
import { describeSeatPoolBehaviour, seatRuntime } from './timeSeats.suite.helper';
import { createTimeSeatPool } from './timeSeats';

/**
 * The seat scripts against a real Redis (`USE_REDIS=true`, `REDIS_URI`, default
 * redis://127.0.0.1:6379). The pool's clock is injected; lease expiry is scored in the sorted
 * set against it, so expiry is tested without waiting.
 */
const describeRedis = process.env.USE_REDIS === 'true' ? describe : describe.skip;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const PREFIX = 'TimeSeats-Integration-Test:';

describeRedis('time seat pool (Redis)', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URI ?? 'redis://127.0.0.1:6379', {
      keyPrefix: PREFIX,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    await redis.connect();
  });

  afterEach(async () => {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys.map((key) => key.slice(PREFIX.length)));
    }
  });

  afterAll(() => {
    redis.disconnect();
  });

  describeSeatPoolBehaviour(async () => {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys.map((key) => key.slice(PREFIX.length)));
    }
    let clock = START;
    return {
      pool: createTimeSeatPool({ redis: () => redis, now: () => clock }),
      advance: (ms) => {
        clock += ms;
      },
    };
  });

  it('gives the meter key its window expiry and repairs one left without it (F7)', async () => {
    const pool = createTimeSeatPool({ redis: () => redis });
    const key = 'TIME_PACK_METER:{time_pack}:u';
    await redis.set(key, '40');
    expect(await redis.pttl(key)).toBe(-1);

    await pool.addMeteredCredits('u', 10, seatRuntime);

    expect(await redis.get(key)).toBe('50');
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(23 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3_600_000);
    await pool.addMeteredCredits('u', 10, seatRuntime);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(ttl);
  });

  it('stores one sorted-set member per generation, scored by its expiry (F1)', async () => {
    const pool = createTimeSeatPool({ redis: () => redis, now: () => START });
    await pool.acquire({ userId: 'a', leaseId: 'stream-1', tenantId: 't1' }, seatRuntime);
    const members = await redis.zrange('TIME_PACK_SEATS:{time_pack}:leases', 0, -1, 'WITHSCORES');
    expect(members).toEqual(['a|stream-1|t1', String(START + 60_000)]);
    expect(await redis.pttl('TIME_PACK_SEATS:{time_pack}:leases')).toBeGreaterThan(0);
  });
});
