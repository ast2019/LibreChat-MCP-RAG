import { logger } from '@librechat/data-schemas';
import type { TimeSeatRedis } from './timeSeats';
import { describeSeatPoolBehaviour, leaseOf, seatRuntime } from './timeSeats.suite.helper';
import { createTimeSeatPool, startTimeSeatHeartbeat } from './timeSeats';

const START = Date.parse('2026-01-01T00:00:00.000Z');

describe('time seat pool (in-memory)', () => {
  describeSeatPoolBehaviour(async () => {
    let clock = START;
    const pool = createTimeSeatPool({ redis: () => null, now: () => clock });
    return {
      pool,
      advance: (ms) => {
        clock += ms;
      },
    };
  });

  it('meters a fixed window that opens at the first usage (F7)', async () => {
    let clock = START;
    const pool = createTimeSeatPool({ redis: () => null, now: () => clock });
    await pool.addMeteredCredits('u', 100, seatRuntime);
    clock += 23 * 3_600_000;
    await pool.addMeteredCredits('u', 50, seatRuntime);
    await expect(pool.getMeteredCredits('u')).resolves.toBe(150);
    clock += 3_600_000 + 1;
    await expect(pool.getMeteredCredits('u')).resolves.toBe(0);
  });
});

describe('time seat pool when Redis errors (F4)', () => {
  const broken = (): TimeSeatRedis => {
    const fail = () => Promise.reject(new Error('ECONNRESET'));
    return { eval: fail, evalsha: fail, zrangebyscore: fail, mget: fail } as TimeSeatRedis;
  };

  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('admits against the in-memory pool by default, keeping maxSeats', async () => {
    const pool = createTimeSeatPool({ redis: broken });
    const runtime = { ...seatRuntime, maxSeats: 1 };
    const first = await pool.acquire({ userId: 'a', leaseId: 'a1' }, runtime);
    expect(first).toMatchObject({ allowed: true, lease: { store: 'memory' } });
    await expect(pool.acquire({ userId: 'b', leaseId: 'b1' }, runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'full',
    });
    await pool.release(leaseOf(first));
    await expect(pool.acquire({ userId: 'b', leaseId: 'b1' }, runtime)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('rejects with reason unavailable when redisFailure is reject', async () => {
    const pool = createTimeSeatPool({ redis: broken });
    await expect(
      pool.acquire({ userId: 'a', leaseId: 'a1' }, { ...seatRuntime, redisFailure: 'reject' }),
    ).resolves.toMatchObject({ allowed: false, reason: 'unavailable' });
  });
});

describe('startTimeSeatHeartbeat (F1)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renews the lease every third of leaseSeconds and stops once it is lost', async () => {
    jest.useFakeTimers();
    let clock = START;
    const pool = createTimeSeatPool({ redis: () => null, now: () => clock });
    const lease = leaseOf(await pool.acquire({ userId: 'a', leaseId: 'a1' }, seatRuntime));
    const renew = jest.spyOn(pool, 'renew');
    const heartbeat = startTimeSeatHeartbeat(pool, lease, seatRuntime);

    for (let tick = 0; tick < 6; tick++) {
      clock += 20_000;
      await jest.advanceTimersByTimeAsync(20_000);
    }
    expect(renew).toHaveBeenCalledTimes(6);
    await expect(pool.listHolders()).resolves.toEqual(['a']);

    await pool.release(lease);
    clock += 20_000;
    await jest.advanceTimersByTimeAsync(20_000);
    clock += 20_000;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(renew).toHaveBeenCalledTimes(7);
    heartbeat.stop();
  });
});
