import type { TimePackRatePool } from './timeRate';
import { createTimePackRatePool, acquireTimePackRateSlot } from './timeRate';

const runtime = {
  requestsPerMinute: 60,
  userSharePerMinute: 20,
  rateWaitMs: 0,
};

const memoryPool = (): TimePackRatePool => createTimePackRatePool({ redis: () => null });

/** A pool whose clock the test drives, so the window can turn over without waiting. */
const clockedPool = (): { pool: TimePackRatePool; advance: (ms: number) => void } => {
  let at = Date.parse('2026-01-10T00:00:30.000Z');
  const pool = createTimePackRatePool({ redis: () => null, now: () => at });
  return { pool, advance: (ms: number) => (at += ms) };
};

describe('createTimePackRatePool (memory)', () => {
  it('counts the global allowance and the user share together', async () => {
    const pool = memoryPool();
    const first = await pool.acquire('u1', runtime);
    expect(first).toMatchObject({ allowed: true, globalCount: 1, userCount: 1 });

    const second = await pool.acquire('u2', runtime);
    expect(second).toMatchObject({ allowed: true, globalCount: 2, userCount: 1 });
  });

  it('refuses a user past their own share while the global allowance is untouched', async () => {
    const pool = memoryPool();
    for (let i = 0; i < 20; i++) {
      await pool.acquire('u1', runtime);
    }
    const refused = await pool.acquire('u1', runtime);
    expect(refused).toMatchObject({ allowed: false, reason: 'user_share' });
    /** A refused request must not consume the shared capacity. */
    expect(refused.globalCount).toBe(20);
  });

  it('refuses once the shared allowance is exhausted, whichever user asks', async () => {
    const pool = memoryPool();
    for (let i = 0; i < 60; i++) {
      const result = await pool.acquire(`u${i}`, runtime);
      expect(result.allowed).toBe(true);
    }
    const refused = await pool.acquire('u-new', runtime);
    expect(refused).toMatchObject({ allowed: false, reason: 'global_full' });
  });

  it('lets a second user use the allowance the first one could not take', async () => {
    const pool = memoryPool();
    for (let i = 0; i < 20; i++) {
      await pool.acquire('u1', runtime);
    }
    expect((await pool.acquire('u1', runtime)).allowed).toBe(false);
    expect((await pool.acquire('u2', runtime)).allowed).toBe(true);
  });

  it('reads back the counters of the shared allowance and the requester', async () => {
    const pool = memoryPool();
    await pool.acquire('u1', runtime);
    await pool.acquire('u1', runtime);
    await pool.acquire('u2', runtime);
    expect(await pool.read('u1')).toEqual({ globalCount: 3, userCount: 2 });
    expect(await pool.read('u2')).toEqual({ globalCount: 3, userCount: 1 });
  });

  it('returns a slot to the window that was charged, so a later gate failure does not starve capacity', async () => {
    const pool = memoryPool();
    const taken = await pool.acquire('u1', runtime);
    expect(taken.allowed).toBe(true);
    if (!taken.allowed) {
      throw new Error('expected acquire to succeed');
    }
    expect(await pool.read('u1')).toEqual({ globalCount: 1, userCount: 1 });
    await pool.release('u1', taken.bucket);
    expect(await pool.read('u1')).toEqual({ globalCount: 0, userCount: 0 });
  });
});

describe('acquireTimePackRateSlot', () => {
  it('waits for the shared capacity and then admits', async () => {
    const { pool, advance } = clockedPool();
    const limited = { ...runtime, requestsPerMinute: 1, userSharePerMinute: 1 };
    expect((await pool.acquire('u1', limited)).allowed).toBe(true);

    const sleeps: number[] = [];
    const result = await acquireTimePackRateSlot({
      userId: 'u2',
      runtime: { ...limited, rateWaitMs: 60_000 },
      pool,
      sleep: async (ms) => {
        sleeps.push(ms);
        /** The window turns over while the request waits for a slot. */
        advance(30_000);
      },
    });
    expect(result.allowed).toBe(true);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('refuses once the wait is over, without waiting forever', async () => {
    const { pool } = clockedPool();
    const limited = { ...runtime, requestsPerMinute: 1, userSharePerMinute: 1 };
    await pool.acquire('u1', limited);

    const sleeps: number[] = [];
    const result = await acquireTimePackRateSlot({
      userId: 'u2',
      runtime: { ...limited, rateWaitMs: 500 },
      pool,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      throw new Error('expected the request to be refused');
    }
    expect(result.reason).toBe('global_full');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('refuses a request over the user share without waiting', async () => {
    const pool = memoryPool();
    for (let i = 0; i < 20; i++) {
      await pool.acquire('u1', runtime);
    }
    const sleeps: number[] = [];
    const result = await acquireTimePackRateSlot({
      userId: 'u1',
      runtime: { ...runtime, rateWaitMs: 5_000 },
      pool,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      throw new Error('expected the request to be refused');
    }
    expect(result.reason).toBe('user_share');
    expect(sleeps).toHaveLength(0);
  });
});
