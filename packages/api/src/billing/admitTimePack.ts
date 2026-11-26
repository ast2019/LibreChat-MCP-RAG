import { isTimePack } from 'librechat-data-provider';
import { ErrorTypes } from 'librechat-data-provider';
import type { TBalanceConfig, TimePackEntitlement } from 'librechat-data-provider';
import type {
  TimeSeatPool,
  TimeSeatLease,
  TimeSeatHeartbeat,
  TimeSeatRejectReason,
  TimeSeatEvictedLease,
} from './timeSeats';
import type { TimePackAdmitUser, TimePackRoutePack, TimePackTargetInput } from './route';
import type { OwnedGenerationControl } from '~/user/generations';
import type { TimePackRatePool } from './timeRate';
import { getTimeSeatPool, startTimeSeatHeartbeat, timePackViolationType } from './timeSeats';
import { acquireTimePackRateSlot, getTimePackRatePool } from './timeRate';
import { resolveTimePackRoute, resolveTimePackTarget } from './route';
import { abortOwnedGeneration } from '~/user/generations';

/** Whether this agents request should use the Claude time-pack seat path. */
export function shouldUseTimePackSeats(params: {
  user?: TimePackAdmitUser | null;
  endpoint?: string | null;
  model?: string | null;
  packs?: readonly TimePackRoutePack[] | null;
}): boolean {
  return resolveTimePackRoute(params).kind === 'seat';
}

export type TimePackAdmitResult =
  | { ok: true; pendingSeats: number; limit: number; lease: TimeSeatLease }
  | {
      ok: false;
      status: 429;
      type: string;
      reason: TimeSeatRejectReason;
      pendingSeats: number;
      limit: number;
      cooldownMs?: number;
      score: number;
      /** False for `held`: a second tab of an entitled user is not abuse. */
      logViolation: boolean;
    };

/**
 * Acquires a shared time-pack seat for one generation (`leaseId`, its stream id). When the pool
 * is full and oversale is allowed, the heaviest holder is force-rested in the same step, and
 * `abortLease` stops only the generations that held the evicted seats.
 */
export async function admitTimePackRequest({
  userId,
  leaseId,
  tenantId,
  balance,
  abortLease,
  pool = getTimeSeatPool(),
}: {
  userId: string;
  leaseId: string;
  tenantId?: string;
  balance?: Partial<TBalanceConfig> | null;
  abortLease: (lease: TimeSeatEvictedLease) => Promise<void>;
  pool?: TimeSeatPool;
}): Promise<TimePackAdmitResult> {
  const result = await pool.acquire(
    { userId, leaseId, ...(tenantId != null && tenantId !== '' && { tenantId }) },
    balance?.timePack,
  );
  if (result.allowed) {
    await Promise.all(
      result.evicted.map((lease) =>
        abortLease(lease).catch(() => {
          /** The evicted run no longer holds a seat; a failed stop leaves it unmetered only. */
        }),
      ),
    );
    return {
      ok: true,
      pendingSeats: result.pendingSeats,
      limit: result.limit,
      lease: result.lease,
    };
  }
  const held = result.reason === 'held';
  return {
    ok: false,
    status: 429,
    type: timePackViolationType(result.reason),
    reason: result.reason,
    pendingSeats: result.pendingSeats,
    limit: result.limit,
    ...(result.cooldownMs != null && { cooldownMs: result.cooldownMs }),
    score: held ? 0 : 1,
    logViolation: !held,
  };
}

/** Request fields the time-pack admission sets and the release reads. */
export type TimePackRequestState = {
  _scheduleConcurrencyExempt?: boolean;
  _timePackSeatHeld?: boolean;
  _timePackLease?: { lease: TimeSeatLease; heartbeat: TimeSeatHeartbeat } | null;
  /** Set for every request on the time-pack route, seat or not; usage is metered against it. */
  _timePackEntitlement?: TimePackEntitlement | null;
};

export type TimePackRequestLike = TimePackRequestState & {
  user?: (TimePackAdmitUser & { tenantId?: string }) | null;
  config?: { balance?: Partial<TBalanceConfig> | null } | null;
};

export type TimePackRequestAdmission =
  | { kind: 'none' }
  | { kind: 'admitted' }
  | {
      kind: 'denied';
      status: 403;
      body: { type: ErrorTypes.TIME_PACK_REQUIRED; code: ErrorTypes.TIME_PACK_REQUIRED };
    }
  | { kind: 'rejected'; admission: Extract<TimePackAdmitResult, { ok: false }> }
  | {
      kind: 'rate_limited';
      status: 429;
      body: {
        type: ErrorTypes.TIME_PACK_RATE_LIMITED;
        code: ErrorTypes.TIME_PACK_RATE_LIMITED;
        message: string;
        retryAfterMs: number;
      };
    };

/**
 * The agents controllers' time-pack gate. Runs before any generation work: a time-pack endpoint
 * without a matching entitlement is denied even for concurrency-exempt (scheduled) runs; with
 * one, a seat is acquired unless the run is exempt, and kept alive by a heartbeat until
 * {@link releaseAdmittedRequestSlot}. `endpoint`/`model` are the agent's real ones: a saved
 * agent's provider, not `agents`.
 */
export async function admitTimePackForRequest(
  req: TimePackRequestLike,
  {
    endpoint,
    model,
    leaseId,
    abortLease,
    pool = getTimeSeatPool(),
    ratePool = getTimePackRatePool(),
  }: {
    endpoint?: string | null;
    model?: string | null;
    leaseId: string;
    abortLease: (lease: TimeSeatEvictedLease) => Promise<void>;
    pool?: TimeSeatPool;
    ratePool?: TimePackRatePool;
  },
): Promise<TimePackRequestAdmission> {
  req._timePackSeatHeld = false;
  req._timePackLease = null;
  req._timePackEntitlement = null;
  const balance = req.config?.balance;
  const route = resolveTimePackRoute({ user: req.user, endpoint, model, packs: balance?.packs });
  if (route.kind === 'none') {
    return { kind: 'none' };
  }
  if (route.kind === 'denied') {
    return {
      kind: 'denied',
      status: 403,
      body: { type: route.code, code: route.code },
    };
  }
  req._timePackEntitlement = route.entitlement;
  const userId = req.user?.id;
  if (req._scheduleConcurrencyExempt === true || !userId) {
    return { kind: 'admitted' };
  }
  /**
   * The gateway's ceiling belongs to the whole key, so it is taken before the seat: a request
   * that cannot be served must not hold a seat while it waits, and a request refused for the
   * shared capacity must not consume one either.
   */
  const rate = await acquireTimePackRateSlot({
    userId,
    runtime: balance?.timePack,
    pool: ratePool,
  });
  if (!rate.allowed) {
    const retryAfterMs = Math.max(1, rate.retryAfterMs);
    return {
      kind: 'rate_limited',
      status: 429,
      body: {
        type: ErrorTypes.TIME_PACK_RATE_LIMITED,
        code: ErrorTypes.TIME_PACK_RATE_LIMITED,
        message:
          rate.reason === 'user_share'
            ? 'درخواست‌های شما در این دقیقه به سقف مجاز رسیده است؛ کمی بعد دوباره تلاش کنید.'
            : 'ظرفیت مشترک پلن در این دقیقه تکمیل است؛ کمی بعد دوباره تلاش کنید.',
        retryAfterMs,
      },
    };
  }
  const admission = await admitTimePackRequest({
    userId,
    leaseId,
    tenantId: req.user?.tenantId,
    balance,
    abortLease,
    pool,
  });
  if (!admission.ok) {
    return { kind: 'rejected', admission };
  }
  req._timePackSeatHeld = true;
  req._timePackLease = {
    lease: admission.lease,
    heartbeat: startTimeSeatHeartbeat(pool, admission.lease, balance?.timePack),
  };
  return { kind: 'admitted' };
}

/**
 * {@link admitTimePackForRequest} on the endpoint and model the agents request really runs on
 * (see {@link resolveTimePackTarget}). Without a configured time pack it returns `none` without
 * waiting for the agent load.
 */
export async function admitAgentTimePack(
  req: TimePackRequestLike,
  {
    endpointOption,
    body,
    leaseId,
    abortLease,
    pool,
    ratePool,
  }: TimePackTargetInput & {
    leaseId: string;
    abortLease: (lease: TimeSeatEvictedLease) => Promise<void>;
    pool?: TimeSeatPool;
    ratePool?: TimePackRatePool;
  },
): Promise<TimePackRequestAdmission> {
  if (!(req.config?.balance?.packs ?? []).some((pack) => isTimePack(pack))) {
    req._timePackSeatHeld = false;
    req._timePackLease = null;
    req._timePackEntitlement = null;
    return { kind: 'none' };
  }
  const { endpoint, model } = await resolveTimePackTarget({ endpointOption, body });
  return admitTimePackForRequest(req, { endpoint, model, leaseId, abortLease, pool, ratePool });
}

/** Stops exactly the generation an evicted lease held, checked against its owner. */
export function abortTimePackLease(
  control: OwnedGenerationControl,
): (lease: TimeSeatEvictedLease) => Promise<void> {
  return async (lease) => {
    await abortOwnedGeneration(
      lease.leaseId,
      { id: lease.userId, ...(lease.tenantId != null && { tenantId: lease.tenantId }) },
      control,
    );
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
  pool = getTimeSeatPool(),
}: {
  req?: TimePackRequestState | null;
  userId?: string | null;
  decrementPendingRequest: (userId: string) => Promise<unknown>;
  pool?: TimeSeatPool;
}): Promise<void> {
  if (req?._scheduleConcurrencyExempt === true || !userId) {
    return;
  }
  if (req?._timePackSeatHeld) {
    req._timePackSeatHeld = false;
    const held = req._timePackLease;
    req._timePackLease = null;
    if (held != null) {
      held.heartbeat.stop();
      await pool.release(held.lease);
    }
    return;
  }
  await decrementPendingRequest(userId);
}
