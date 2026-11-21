import {
  __resetTimePackSeatsForTests,
  acquireTimePackSeat,
  addTimePackMeteredCredits,
  releaseTimePackSeat,
  tryOversellTimePackSeat,
} from './timeSeats';

const runtime = {
  maxSeats: 2,
  maxSeatsPerUser: 1,
  restMinutes: 60,
  usageWindowHours: 24,
  oversellMinMeteredCredits: 100,
};

describe('timeSeats (in-memory)', () => {
  beforeEach(() => {
    __resetTimePackSeatsForTests();
  });

  it('admits up to maxSeats and rejects a second seat for the same user', async () => {
    await expect(acquireTimePackSeat('a', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(acquireTimePackSeat('a', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'held',
    });
    await expect(acquireTimePackSeat('b', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(acquireTimePackSeat('c', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'full',
    });
  });

  it('releases a seat so another user can enter', async () => {
    await acquireTimePackSeat('a', runtime);
    await acquireTimePackSeat('b', runtime);
    await releaseTimePackSeat('a');
    await expect(acquireTimePackSeat('c', runtime)).resolves.toMatchObject({ allowed: true });
  });

  it('force-rests the heaviest holder when oversale threshold is met', async () => {
    await acquireTimePackSeat('heavy', runtime);
    await acquireTimePackSeat('light', runtime);
    await addTimePackMeteredCredits('heavy', 500, runtime);
    await addTimePackMeteredCredits('light', 10, runtime);

    const abortHolder = jest.fn().mockResolvedValue(undefined);
    const result = await tryOversellTimePackSeat('new', runtime, abortHolder);

    expect(result).toMatchObject({ allowed: true });
    expect(abortHolder).toHaveBeenCalledWith('heavy');
    await expect(acquireTimePackSeat('heavy', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'cooldown',
    });
  });

  it('does not oversell when no holder meets the threshold', async () => {
    await acquireTimePackSeat('a', runtime);
    await acquireTimePackSeat('b', runtime);
    await addTimePackMeteredCredits('a', 10, runtime);
    const result = await tryOversellTimePackSeat('c', runtime, jest.fn());
    expect(result).toBeNull();
  });
});
