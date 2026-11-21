import { cacheConfig, ioredisClient } from '~/cache';
import { createTimeSeatService } from './timeSeats';
import type { TimeSeatService } from './timeSeats';

/** App-composed seat pool: Redis when configured, otherwise in-memory. */
export const appTimeSeatService: TimeSeatService = createTimeSeatService({
  useRedis: cacheConfig.USE_REDIS,
  redis: ioredisClient,
});

export async function listTimePackHolders(): Promise<string[]> {
  return appTimeSeatService.listHolders();
}

export async function getTimePackMeteredCredits(userId: string): Promise<number> {
  return appTimeSeatService.getMeteredCredits(userId);
}

export async function addTimePackMeteredCredits(
  ...args: Parameters<TimeSeatService['addMeteredCredits']>
): Promise<void> {
  return appTimeSeatService.addMeteredCredits(...args);
}

export async function forceRestTimePackUser(
  ...args: Parameters<TimeSeatService['forceRest']>
): Promise<void> {
  return appTimeSeatService.forceRest(...args);
}

export async function acquireTimePackSeat(
  ...args: Parameters<TimeSeatService['acquire']>
): ReturnType<TimeSeatService['acquire']> {
  return appTimeSeatService.acquire(...args);
}

export async function releaseTimePackSeat(userId: string): Promise<void> {
  return appTimeSeatService.release(userId);
}

export async function tryOversellTimePackSeat(
  ...args: Parameters<TimeSeatService['tryOversell']>
): ReturnType<TimeSeatService['tryOversell']> {
  return appTimeSeatService.tryOversell(...args);
}

/** Test-only: clear in-memory state on the app-composed service. */
export function __resetTimePackSeatsForTests(): void {
  appTimeSeatService.resetForTests();
}
