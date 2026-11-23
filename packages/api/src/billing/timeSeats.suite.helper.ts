/* eslint-disable jest/no-export -- A shared behaviour suite both seat-store specs run, not a
 * spec of its own. */
import type { TTimePackRuntime } from 'librechat-data-provider';
import type { TimeSeatPool, TimeSeatAcquireResult, TimeSeatLease } from './timeSeats';

export type SeatPoolHarness = {
  pool: TimeSeatPool;
  /** Moves the pool's clock forward. */
  advance: (ms: number) => void;
};

export const seatRuntime: Partial<TTimePackRuntime> = {
  maxSeats: 2,
  maxSeatsPerUser: 1,
  restMinutes: 60,
  usageWindowHours: 24,
  oversellMinMeteredCredits: 100,
  leaseSeconds: 60,
};

export function leaseOf(result: TimeSeatAcquireResult): TimeSeatLease {
  if (!result.allowed) {
    throw new Error(`expected a seat, got ${result.reason}`);
  }
  return result.lease;
}

/**
 * Behaviour both seat stores (Redis and in-memory) must share. `create` returns a fresh, empty
 * pool whose clock starts at the same instant for every test.
 */
export function describeSeatPoolBehaviour(create: () => Promise<SeatPoolHarness>): void {
  let harness: SeatPoolHarness;
  const acquire = (userId: string, leaseId = `${userId}-stream`, runtime = seatRuntime) =>
    harness.pool.acquire({ userId, leaseId }, runtime);

  beforeEach(async () => {
    harness = await create();
  });

  it('admits up to maxSeats and holds the per-user cap', async () => {
    await expect(acquire('a')).resolves.toMatchObject({ allowed: true });
    await expect(acquire('a', 'a-second-tab')).resolves.toMatchObject({
      allowed: false,
      reason: 'held',
    });
    await expect(acquire('b')).resolves.toMatchObject({ allowed: true });
    await expect(acquire('c')).resolves.toMatchObject({ allowed: false, reason: 'full' });
  });

  it('allows maxSeatsPerUser generations per user (F5)', async () => {
    const runtime = { ...seatRuntime, maxSeats: 4, maxSeatsPerUser: 2 };
    await expect(acquire('a', 'one', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(acquire('a', 'two', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(acquire('a', 'three', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'held',
    });
  });

  it('releases only the released generation', async () => {
    const lease = leaseOf(await acquire('a'));
    await acquire('b');
    await harness.pool.release(lease);
    await expect(acquire('c')).resolves.toMatchObject({ allowed: true });
    await expect(harness.pool.listHolders()).resolves.toEqual(expect.arrayContaining(['b', 'c']));
  });

  it('frees the seat of a generation that stopped renewing (F1)', async () => {
    await acquire('crashed');
    await acquire('b');
    harness.advance(61_000);
    await expect(acquire('crashed', 'crashed-retry')).resolves.toMatchObject({ allowed: true });
    await expect(harness.pool.listHolders()).resolves.toEqual(['crashed']);
  });

  it('keeps a renewed lease past its first expiry and reports a lost one (F1)', async () => {
    const lease = leaseOf(await acquire('long'));
    harness.advance(40_000);
    await expect(harness.pool.renew(lease, seatRuntime)).resolves.toBe(true);
    harness.advance(40_000);
    await acquire('b');
    await expect(acquire('c')).resolves.toMatchObject({ allowed: false, reason: 'full' });
    harness.advance(61_000);
    await expect(harness.pool.renew(lease, seatRuntime)).resolves.toBe(false);
  });

  it('evicts the heaviest holder in the same step that admits the requester (F6)', async () => {
    await acquire('heavy', 'heavy-stream');
    await acquire('light', 'light-stream');
    await harness.pool.addMeteredCredits('heavy', 500, seatRuntime);
    await harness.pool.addMeteredCredits('light', 10, seatRuntime);

    const result = await acquire('new');

    expect(result).toMatchObject({
      allowed: true,
      evicted: [{ userId: 'heavy', leaseId: 'heavy-stream' }],
    });
    await expect(acquire('third')).resolves.toMatchObject({ allowed: false, reason: 'full' });
    await expect(acquire('heavy', 'heavy-again')).resolves.toMatchObject({
      allowed: false,
      reason: 'cooldown',
    });
    await expect(harness.pool.listHolders()).resolves.toEqual(
      expect.arrayContaining(['light', 'new']),
    );
  });

  it('does not oversell below the metered threshold', async () => {
    await acquire('a');
    await acquire('b');
    await harness.pool.addMeteredCredits('a', 10, seatRuntime);
    await expect(acquire('c')).resolves.toMatchObject({ allowed: false, reason: 'full' });
  });
}
