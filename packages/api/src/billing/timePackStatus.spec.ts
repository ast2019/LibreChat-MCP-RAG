import { readTimePackStatus } from './timePackStatus';
import { createTimePackRatePool } from './timeRate';
import { createTimeSeatPool } from './timeSeats';

const NOW = 1_800_000_000_000;

describe('readTimePackStatus', () => {
  it('reports the seat pool and the shared rate together', async () => {
    const seatPool = createTimeSeatPool({ redis: () => null, now: () => NOW });
    const ratePool = createTimePackRatePool({ redis: () => null, now: () => NOW });

    await seatPool.acquire({ userId: 'user-1', leaseId: 'stream-1' }, { maxSeats: 4 });
    await ratePool.acquire('user-1', { requestsPerMinute: 60, userSharePerMinute: 20 });

    const status = await readTimePackStatus({
      userId: 'user-1',
      runtime: { maxSeats: 4, requestsPerMinute: 60, userSharePerMinute: 20 },
      seatPool,
      ratePool,
    });

    expect(status.activeSeats).toBe(1);
    expect(status.maxSeats).toBe(4);
    expect(status.holders).toBe(1);
    expect(status.globalRequests).toBe(1);
    expect(status.userRequests).toBe(1);
    expect(status.requestsPerMinute).toBe(60);
    expect(status.userSharePerMinute).toBe(20);
  });

  it('counts every user in one shared counter', async () => {
    const seatPool = createTimeSeatPool({ redis: () => null, now: () => NOW });
    const ratePool = createTimePackRatePool({ redis: () => null, now: () => NOW });

    await ratePool.acquire('user-1', { requestsPerMinute: 60, userSharePerMinute: 20 });
    await ratePool.acquire('user-2', { requestsPerMinute: 60, userSharePerMinute: 20 });

    const status = await readTimePackStatus({
      userId: 'user-1',
      runtime: { requestsPerMinute: 60, userSharePerMinute: 20 },
      seatPool,
      ratePool,
    });

    expect(status.globalRequests).toBe(2);
    expect(status.userRequests).toBe(1);
  });

  it('falls back to zeroes when a pool cannot be read', async () => {
    const status = await readTimePackStatus({
      userId: 'user-1',
      runtime: { maxSeats: 4 },
      seatPool: {
        readStatus: () => Promise.reject(new Error('redis is down')),
      },
      ratePool: {
        read: () => Promise.reject(new Error('redis is down')),
        now: () => NOW,
      } as never,
    });

    expect(status.activeSeats).toBe(0);
    expect(status.holders).toBe(0);
    expect(status.globalRequests).toBe(0);
    expect(status.userRequests).toBe(0);
    expect(status.maxSeats).toBe(4);
  });

  it('says how long until the minute turns over', async () => {
    const seatPool = createTimeSeatPool({ redis: () => null, now: () => NOW });
    const ratePool = createTimePackRatePool({ redis: () => null, now: () => NOW });

    const status = await readTimePackStatus({ userId: 'user-1', seatPool, ratePool });

    expect(status.windowResetsInMs).toBeGreaterThan(0);
    expect(status.windowResetsInMs).toBeLessThanOrEqual(60_000);
  });
});
