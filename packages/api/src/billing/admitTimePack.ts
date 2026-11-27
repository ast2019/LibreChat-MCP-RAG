import { logger } from '@librechat/data-schemas';
import { ErrorTypes } from 'librechat-data-provider';
import { isTimePack, getActiveTimePackEntitlement } from 'librechat-data-provider';
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
import {
  isConfiguredTimePackEndpoint,
  resolveTimePackRoute,
  resolveTimePackSpecTarget,
  resolveTimePackTarget,
} from './route';
import { getTimeSeatPool, startTimeSeatHeartbeat, timePackViolationType } from './timeSeats';
import { acquireTimePackRateSlot, getTimePackRatePool } from './timeRate';
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

export type TimePackDenyReason =
  | 'no_entitlement'
  | 'route_denied'
  | 'none_fail_closed'
  | 'missing_pack_config';

function denyTimePackRequired(
  req: TimePackRequestLike,
  context: {
    reason: TimePackDenyReason;
    endpoint?: string | null;
    model?: string | null;
    spec?: string | null;
    timePackTarget?: boolean;
    fromSpecTimePack?: boolean;
    admissionKind?: string;
  },
): {
  kind: 'denied';
  status: 403;
  body: {
    type: ErrorTypes.TIME_PACK_REQUIRED;
    code: ErrorTypes.TIME_PACK_REQUIRED;
    reason: TimePackDenyReason;
  };
} {
  req._timePackSeatHeld = false;
  req._timePackLease = null;
  req._timePackEntitlement = null;
  const user = req.user;
  /** Always WARN: debug-share with debug mode off previously hid these denies entirely. */
  logger.warn('[timePack] time_pack_required (admit denied)', {
    reason: context.reason,
    userId: user?.id,
    endpoint: context.endpoint ?? null,
    model: context.model ?? null,
    spec: context.spec ?? null,
    timePackTarget: context.timePackTarget === true,
    fromSpecTimePack: context.fromSpecTimePack === true,
    admissionKind: context.admissionKind ?? null,
    userTimePackId: typeof user?.timePackId === 'string' ? user.timePackId : null,
    userTimePackEndpoint:
      typeof user?.timePackEndpoint === 'string' ? user.timePackEndpoint : null,
    userTimePackExpiresAt: user?.timePackExpiresAt ?? null,
    hasActiveEntitlement: getActiveTimePackEntitlement(user ?? undefined) != null,
  });
  return {
    kind: 'denied',
    status: 403,
    body: {
      type: ErrorTypes.TIME_PACK_REQUIRED,
      code: ErrorTypes.TIME_PACK_REQUIRED,
      reason: context.reason,
    },
  };
}

/**
 * Time packs always use the configured pack gateway (ClaudeTime), not a stale rename on the
 * user (ClaudeTime3D). Blank or divergent `timePackEndpoint` is overwritten from packs.
 */
function repairUserTimePackEndpointFromPacks(
  user: TimePackRequestLike['user'],
  packs: readonly TimePackRoutePack[] | null | undefined,
): boolean {
  if (user == null) {
    return false;
  }
  const id = typeof user.timePackId === 'string' ? user.timePackId.trim() : '';
  if (!id) {
    return false;
  }
  const pack = packs?.find((entry) => entry.id === id && isTimePack(entry));
  const fromPack = typeof pack?.endpoint === 'string' ? pack.endpoint.trim() : '';
  if (!fromPack) {
    return false;
  }
  const current =
    typeof user.timePackEndpoint === 'string' ? user.timePackEndpoint.trim() : '';
  if (current === fromPack) {
    return false;
  }
  user.timePackEndpoint = fromPack;
  return true;
}

export type TimePackRequestAdmission =
  | { kind: 'none' }
  | { kind: 'admitted' }
  | {
      kind: 'denied';
      status: 403;
      body: {
        type: ErrorTypes.TIME_PACK_REQUIRED;
        code: ErrorTypes.TIME_PACK_REQUIRED;
        reason?: TimePackDenyReason;
      };
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
    return denyTimePackRequired(req, {
      reason: 'route_denied',
      endpoint,
      model,
      admissionKind: 'route_denied',
    });
  }
  req._timePackEntitlement = route.entitlement;
  const userId = req.user?.id;
  if (req._scheduleConcurrencyExempt === true || !userId) {
    logger.debug('[timePack] admitted without seat (exempt or missing user)', {
      userId,
      endpoint,
      model,
      exempt: req._scheduleConcurrencyExempt === true,
      timePackId: route.entitlement.timePackId,
    });
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
    logger.debug('[timePack] rate limited', {
      userId,
      endpoint,
      model,
      reason: rate.reason,
      globalCount: rate.globalCount,
      userCount: rate.userCount,
      retryAfterMs,
    });
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
    /**
     * The rate slot was taken so a waiting request would not hold a seat. When the seat gate
     * then refuses, give the slot back: otherwise seat contention would spend the shared
     * minute's allowance on requests that never reached the gateway.
     */
    await ratePool.release(userId, rate.bucket);
    logger.debug('[timePack] seat rejected', {
      userId,
      endpoint,
      model,
      reason: admission.reason,
      pendingSeats: admission.pendingSeats,
      limit: admission.limit,
    });
    return { kind: 'rejected', admission };
  }
  req._timePackSeatHeld = true;
  req._timePackLease = {
    lease: admission.lease,
    heartbeat: startTimeSeatHeartbeat(pool, admission.lease, balance?.timePack),
  };
  logger.debug('[timePack] seat acquired (ClaudeTime path)', {
    userId,
    endpoint,
    model,
    timePackId: route.entitlement.timePackId,
    pendingSeats: admission.pendingSeats,
    limit: admission.limit,
    globalRequests: rate.globalCount,
    userRequests: rate.userCount,
  });
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
  const packs = req.config?.balance?.packs ?? [];
  const hasTimePackConfig = packs.some((pack) => isTimePack(pack));
  /** Align user.timePackEndpoint to the configured pack gateway before routing. */
  if (repairUserTimePackEndpointFromPacks(req.user, packs)) {
    logger.warn('[timePack] normalized user.timePackEndpoint to configured pack gateway', {
      userId: req.user?.id,
      timePackId: req.user?.timePackId,
      timePackEndpoint: req.user?.timePackEndpoint,
    });
  }
  let { endpoint, model } = await resolveTimePackTarget({
    endpointOption,
    body,
    config: req.config,
  });
  /**
   * Product rule: every time-pack turn uses the configured gateway (ClaudeTime) — the same
   * custom endpoint for ingress and egress. Only force when this request is a timePack
   * modelSpec; OpenRouter / credit Claude must stay on the credit path.
   */
  const fromSpec = resolveTimePackSpecTarget({
    endpointOption,
    body,
    config: req.config,
  });
  const packGateway =
    (typeof req.user?.timePackId === 'string'
      ? packs.find((entry) => entry.id === req.user?.timePackId && isTimePack(entry))?.endpoint?.trim()
      : '') ||
    packs.find((entry) => isTimePack(entry))?.endpoint?.trim() ||
    null;
  const canonicalGateway =
    (fromSpec.timePack && fromSpec.endpoint) || packGateway || null;
  if (canonicalGateway && fromSpec.timePack === true) {
    if (endpoint !== canonicalGateway) {
      logger.warn('[timePack] forcing time-pack turn onto configured gateway', {
        userId: req.user?.id,
        from: endpoint,
        to: canonicalGateway,
        spec: endpointOption?.spec ?? body?.spec ?? null,
      });
    }
    endpoint = canonicalGateway;
    if ((model == null || model === '') && fromSpec.model) {
      model = fromSpec.model;
    }
  }
  const entitlement = getActiveTimePackEntitlement(req.user ?? undefined);
  const timePackTarget =
    isConfiguredTimePackEndpoint(endpoint, req.config) || fromSpec.timePack === true;
  const specName = endpointOption?.spec ?? body?.spec ?? null;
  /**
   * An active entitlement must still reach the seat path when the live pack list lost
   * `kind: time` (admin override). Otherwise ClaudeTime runs as a credited custom endpoint:
   * Balance.check reserves tokens, seats stay at 0, and debug shows no `[timePack]` lines.
   */
  if (!hasTimePackConfig) {
    if (entitlement == null) {
      if (timePackTarget) {
        return denyTimePackRequired(req, {
          reason: 'missing_pack_config',
          endpoint,
          model,
          spec: specName,
          timePackTarget: true,
          fromSpecTimePack: fromSpec.timePack === true,
        });
      }
      req._timePackSeatHeld = false;
      req._timePackLease = null;
      req._timePackEntitlement = null;
      return { kind: 'none' };
    }
    logger.warn(
      '[timePack] balance.packs has no kind:time row; admitting from user entitlement only',
      {
        userId: req.user?.id,
        timePackId: entitlement.timePackId,
        timePackEndpoint: entitlement.timePackEndpoint,
      },
    );
  }
  const admission = await admitTimePackForRequest(req, {
    endpoint,
    model,
    leaseId,
    abortLease,
    pool,
    ratePool,
  });
  /**
   * Scenario invariant: ClaudeTime / timePack turns never fall through as `none` (credits).
   * Holder → seat (or rate/seat reject). No pack → `time_pack_required`.
   */
  if (admission.kind === 'none' && timePackTarget) {
    return denyTimePackRequired(req, {
      reason: entitlement == null ? 'no_entitlement' : 'none_fail_closed',
      endpoint,
      model,
      spec: specName,
      timePackTarget: true,
      fromSpecTimePack: fromSpec.timePack === true,
      admissionKind: 'none',
    });
  }
  return admission;
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
