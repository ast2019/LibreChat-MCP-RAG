import { createTimeSeatService } from './timeSeats';

const runtime = {
  maxSeats: 2,
  maxSeatsPerUser: 1,
  restMinutes: 60,
  usageWindowHours: 24,
  oversellMinMeteredCredits: 100,
};

describe('timeSeats (in-memory)', () => {
  const seats = createTimeSeatService({ useRedis: false, redis: null });

  beforeEach(() => {
    seats.resetForTests();
  });

  it('admits up to maxSeats and rejects a second seat for the same user', async () => {
    await expect(seats.acquire('a', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(seats.acquire('a', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'held',
    });
    await expect(seats.acquire('b', runtime)).resolves.toMatchObject({ allowed: true });
    await expect(seats.acquire('c', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'full',
    });
  });

  it('enforces configured maxSeatsPerUser above 1', async () => {
    const multi = { ...runtime, maxSeats: 4, maxSeatsPerUser: 2 };
    await expect(seats.acquire('a', multi)).resolves.toMatchObject({ allowed: true });
    await expect(seats.acquire('a', multi)).resolves.toMatchObject({ allowed: true });
    await expect(seats.acquire('a', multi)).resolves.toMatchObject({
      allowed: false,
      reason: 'held',
    });
    await seats.release('a');
    await expect(seats.acquire('a', multi)).resolves.toMatchObject({ allowed: true });
  });

  it('releases a seat so another user can enter', async () => {
    await seats.acquire('a', runtime);
    await seats.acquire('b', runtime);
    await seats.release('a');
    await expect(seats.acquire('c', runtime)).resolves.toMatchObject({ allowed: true });
  });

  it('force-rests the heaviest holder when oversale threshold is met', async () => {
    await seats.acquire('heavy', runtime);
    await seats.acquire('light', runtime);
    await seats.addMeteredCredits('heavy', 500, runtime);
    await seats.addMeteredCredits('light', 10, runtime);

    const abortHolder = jest.fn().mockResolvedValue(undefined);
    const result = await seats.tryOversell('new', runtime, abortHolder);

    expect(result).toMatchObject({ allowed: true });
    expect(abortHolder).toHaveBeenCalledWith('heavy');
    await expect(seats.acquire('heavy', runtime)).resolves.toMatchObject({
      allowed: false,
      reason: 'cooldown',
    });
  });

  it('does not oversell when no holder meets the threshold', async () => {
    await seats.acquire('a', runtime);
    await seats.acquire('b', runtime);
    await seats.addMeteredCredits('a', 10, runtime);
    const result = await seats.tryOversell('c', runtime, jest.fn());
    expect(result).toBeNull();
  });
});
