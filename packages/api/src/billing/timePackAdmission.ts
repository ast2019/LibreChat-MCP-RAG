import { logger } from '@librechat/data-schemas';
import { isTimePack } from 'librechat-data-provider';
import type { TimePackEntitlement } from 'librechat-data-provider';
import type { TimePackRequestAdmission, TimePackRequestLike } from './admitTimePack';
import type { TimeSeatPool, TimeSeatEvictedLease } from './timeSeats';
import type { TimePackRatePool } from './timeRate';
import { admitTimePackForRequest } from './admitTimePack';
import { resolveTimePackRoute } from './route';

/**
 * One admission decision for every path that can reach a time-pack endpoint.
 *
 * The chat path (agents request/resume) and the programming API path differ only in where the
 * endpoint and model come from: the chat path reads them off the request and the loaded agent,
 * the API path off the resolved agent it is about to run. Everything after that — the
 * entitlement check, the shared request rate, the seat, the release — must behave the same, or
 * the programming API becomes a way around the plan's limits.
 *
 * The admission is the only place the shared rate is taken, so the 60-requests-a-minute ceiling
 * covers every path that talks to the gateway, not just the chat composer.
 */

export type TimePackAdmissionTarget = {
  /** The endpoint the request really runs on (a saved agent's provider, not `agents`). */
  endpoint?: string | null;
  /** The model the request really runs on. */
  model?: string | null;
};

export type TimePackAdmissionOutcome =
  | { kind: 'none' }
  | { kind: 'admitted'; entitlement: TimePackEntitlement | null }
  | { kind: 'denied'; status: 403; body: { type: string; code: string } }
  | { kind: 'rate_limited'; status: 429; body: { retryAfterMs: number; message: string } }
  | { kind: 'rejected'; status: 429; admission: { reason: string; limit: number } };

/**
 * Admits a request onto the time-pack path, taking the shared request rate and a seat.
 *
 * `leaseId` identifies the generation the seat belongs to; the same id must reach
 * {@link releaseAdmittedRequestSlot} so the seat is given back when the run ends.
 */
export async function admitTimePackForApi({
  req,
  endpoint,
  model,
  leaseId,
  abortLease,
  pool,
  ratePool,
}: {
  req: TimePackRequestLike;
  endpoint?: string | null;
  model?: string | null;
  leaseId: string;
  abortLease: (lease: TimeSeatEvictedLease) => Promise<void>;
  pool?: TimeSeatPool;
  ratePool?: TimePackRatePool;
}): Promise<TimePackRequestAdmission> {
  const packs = req.config?.balance?.packs;
  if (!(packs ?? []).some((pack) => isTimePack(pack))) {
    req._timePackSeatHeld = false;
    req._timePackLease = null;
    req._timePackEntitlement = null;
    return { kind: 'none' };
  }
  const route = resolveTimePackRoute({ user: req.user, endpoint, model, packs });
  if (route.kind === 'none') {
    req._timePackSeatHeld = false;
    req._timePackLease = null;
    req._timePackEntitlement = null;
    return { kind: 'none' };
  }
  return admitTimePackForRequest(req, {
    endpoint,
    model,
    leaseId,
    abortLease,
    pool,
    ratePool,
  });
}

/**
 * Whether the request's endpoint and model belong to the time pack at all, whatever the
 * user's entitlement. The programming API uses it to refuse a time-pack run before it loads
 * the agent, so a caller without the plan learns the answer without spending a seat.
 */
export function isTimePackTarget({
  req,
  endpoint,
  model,
}: {
  req: TimePackRequestLike;
  endpoint?: string | null;
  model?: string | null;
}): boolean {
  const packs = req.config?.balance?.packs;
  return resolveTimePackRoute({ user: req.user, endpoint, model, packs }).kind !== 'none';
}

/** A one-line summary of why a request was refused, for the log. */
export function describeTimePackRefusal(outcome: TimePackRequestAdmission): string {
  switch (outcome.kind) {
    case 'denied':
      return 'time-pack endpoint without an active entitlement';
    case 'rate_limited':
      return `shared request rate exhausted (${outcome.body.code})`;
    case 'rejected':
      return `seat pool refused the request (${outcome.admission.reason})`;
    default:
      return 'admitted';
  }
}

/** Logs a refusal at the level that matches its cause. */
export function logTimePackRefusal(
  logPrefix: string,
  outcome: TimePackRequestAdmission,
  error?: unknown,
): void {
  if (error != null) {
    logger.error(`${logPrefix} ${describeTimePackRefusal(outcome)}`, error);
    return;
  }
  logger.warn(`${logPrefix} ${describeTimePackRefusal(outcome)}`);
}
