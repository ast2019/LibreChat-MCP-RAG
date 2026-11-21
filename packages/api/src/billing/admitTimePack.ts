import { getActiveTimePackEntitlement, isTimePackClaudeRequest } from 'librechat-data-provider';
import type { TBalanceConfig, TBalancePack } from 'librechat-data-provider';
import type { TimeSeatAcquireResult, TimeSeatService } from './timeSeats';
import { timePackViolationType } from './timeSeats';
import { appTimeSeatService } from './timeSeats.runtime';

export type TimePackAdmitUser = {
  id?: string;
  timePackId?: string | null;
  timePackLabel?: string | null;
  timePackExpiresAt?: Date | string | null;
  timePackGrantedAt?: Date | string | null;
  timePackEndpoint?: string | null;
};

/** Whether this agents request should use the Claude time-pack seat path. */
export function shouldUseTimePackSeats({
  user,
  endpoint,
  model,
  packs,
}: {
  user?: TimePackAdmitUser | null;
  endpoint?: string | null;
  model?: string | null;
  packs?: readonly TBalancePack[] | null;
}): boolean {
  const entitlement = getActiveTimePackEntitlement(user ?? undefined);
  if (entitlement == null) {
    return false;
  }
  const pack = packs?.find((entry) => entry.id === entitlement.timePackId);
  return isTimePackClaudeRequest({
    entitlement: {
      ...entitlement,
      ...(pack?.models != null && { models: pack.models }),
    },
    endpoint,
    model,
    models: pack?.models,
  });
}

export type TimePackAdmitResult =
  | { ok: true; pendingSeats: number; limit: number }
  | {
      ok: false;
      status: 429;
      type: string;
      reason: 'cooldown' | 'held' | 'full' | 'unavailable';
      pendingSeats: number;
      limit: number;
      cooldownMs?: number;
      score: number;
    };

/**
 * Acquires a shared time-pack seat, force-resting a heavy holder when the pool is full and
 * oversale is allowed. `abortHolder` stops the rested user's in-flight generations.
 */
export async function admitTimePackRequest({
  userId,
  balance,
  abortHolder,
  seats = appTimeSeatService,
}: {
  userId: string;
  balance?: Partial<TBalanceConfig> | null;
  abortHolder: (userId: string) => Promise<void>;
  seats?: Pick<TimeSeatService, 'acquire' | 'tryOversell'>;
}): Promise<TimePackAdmitResult> {
  const runtime = balance?.timePack;
  let result: TimeSeatAcquireResult = await seats.acquire(userId, runtime);
  if (!result.allowed && result.reason === 'full') {
    const oversold = await seats.tryOversell(userId, runtime, abortHolder);
    if (oversold != null) {
      result = oversold;
    }
  }
  if (result.allowed) {
    return { ok: true, pendingSeats: result.pendingSeats, limit: result.limit };
  }
  return {
    ok: false,
    status: 429,
    type: timePackViolationType(result.reason),
    reason: result.reason,
    pendingSeats: result.pendingSeats,
    limit: result.limit,
    ...(result.cooldownMs != null && { cooldownMs: result.cooldownMs }),
    score: 1,
  };
}

/**
 * Releases whichever concurrency slot the agents controller admitted: a time-pack seat or
 * the legacy per-user pending-request counter. No-op when the request was concurrency-exempt.
 */
export async function releaseAdmittedRequestSlot({
  req,
  userId,
  decrementPendingRequest,
  seats = appTimeSeatService,
}: {
  req?: {
    _scheduleConcurrencyExempt?: boolean;
    _timePackSeatHeld?: boolean;
  } | null;
  userId?: string | null;
  decrementPendingRequest: (userId: string) => Promise<unknown>;
  seats?: Pick<TimeSeatService, 'release'>;
}): Promise<void> {
  if (req?._scheduleConcurrencyExempt === true || !userId) {
    return;
  }
  if (req?._timePackSeatHeld) {
    req._timePackSeatHeld = false;
    await seats.release(userId);
    return;
  }
  await decrementPendingRequest(userId);
}
