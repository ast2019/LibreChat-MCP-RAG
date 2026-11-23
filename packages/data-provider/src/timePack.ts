import type { TBalancePack, TTimePackRuntime } from './config';
import {
  DEFAULT_TIME_PACK_OVERSELL_MIN_METERED_CREDITS,
  DEFAULT_TIME_PACK_MAX_SEATS_PER_USER,
  DEFAULT_TIME_PACK_USAGE_WINDOW_HOURS,
  DEFAULT_TIME_PACK_REDIS_FAILURE,
  DEFAULT_TIME_PACK_LEASE_SECONDS,
  DEFAULT_TIME_PACK_REST_MINUTES,
  DEFAULT_TIME_PACK_MAX_SEATS,
} from './config';

/** Ledger context for time-path Claude usage that must not change tokenCredits. */
export const TIME_METER_CONTEXT = 'time_meter';

export type TimePackEntitlement = {
  timePackId: string;
  timePackLabel?: string;
  timePackExpiresAt: Date;
  timePackGrantedAt?: Date;
  timePackEndpoint: string;
  models?: string[];
};

export type TimePackFields = {
  timePackId?: string | null;
  timePackLabel?: string | null;
  timePackExpiresAt?: Date | string | null;
  timePackGrantedAt?: Date | string | null;
  timePackEndpoint?: string | null;
};

/** Runtime knobs with defaults applied. */
export function resolveTimePackRuntime(
  config: Partial<TTimePackRuntime> | null | undefined,
): Required<TTimePackRuntime> {
  return {
    maxSeats: config?.maxSeats ?? DEFAULT_TIME_PACK_MAX_SEATS,
    maxSeatsPerUser: config?.maxSeatsPerUser ?? DEFAULT_TIME_PACK_MAX_SEATS_PER_USER,
    restMinutes: config?.restMinutes ?? DEFAULT_TIME_PACK_REST_MINUTES,
    usageWindowHours: config?.usageWindowHours ?? DEFAULT_TIME_PACK_USAGE_WINDOW_HOURS,
    oversellMinMeteredCredits:
      config?.oversellMinMeteredCredits ?? DEFAULT_TIME_PACK_OVERSELL_MIN_METERED_CREDITS,
    leaseSeconds: config?.leaseSeconds ?? DEFAULT_TIME_PACK_LEASE_SECONDS,
    redisFailure: config?.redisFailure ?? DEFAULT_TIME_PACK_REDIS_FAILURE,
  };
}

export function isTimePack(
  pack: Pick<TBalancePack, 'kind'> | { kind?: TBalancePack['kind'] } | null | undefined,
): boolean {
  return pack?.kind === 'time';
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether `endpoint` is the dedicated endpoint of any configured `kind: time` pack. */
export function isTimePackEndpoint(
  packs: readonly Pick<TBalancePack, 'kind' | 'endpoint'>[] | null | undefined,
  endpoint: string | null | undefined,
): boolean {
  if (!endpoint) {
    return false;
  }
  return (packs ?? []).some((pack) => isTimePack(pack) && pack.endpoint?.trim() === endpoint);
}

/** Active Claude time entitlement, or null when missing/expired. */
export function getActiveTimePackEntitlement(
  fields: TimePackFields | null | undefined,
  now: Date = new Date(),
): TimePackEntitlement | null {
  if (fields == null) {
    return null;
  }
  const expiresAt = asDate(fields.timePackExpiresAt);
  const id = typeof fields.timePackId === 'string' ? fields.timePackId.trim() : '';
  const endpoint =
    typeof fields.timePackEndpoint === 'string' ? fields.timePackEndpoint.trim() : '';
  if (!id || !endpoint || expiresAt == null || expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return {
    timePackId: id,
    ...(typeof fields.timePackLabel === 'string' &&
      fields.timePackLabel.trim() !== '' && { timePackLabel: fields.timePackLabel.trim() }),
    timePackExpiresAt: expiresAt,
    ...(asDate(fields.timePackGrantedAt) != null && {
      timePackGrantedAt: asDate(fields.timePackGrantedAt) as Date,
    }),
    timePackEndpoint: endpoint,
  };
}

/** Expiry instant for a time pack granted at `grantedAt`. */
export function timePackExpiresAt(grantedAt: Date, durationDays: number): Date {
  const expires = new Date(grantedAt.getTime());
  expires.setUTCDate(expires.getUTCDate() + durationDays);
  return expires;
}

/**
 * Expiry for a (re-)grant: `durationDays` added to the later of `now` and the current expiry, so
 * granting again before the end keeps the remaining days.
 */
export function extendTimePackExpiry({
  currentExpiresAt,
  now,
  durationDays,
}: {
  currentExpiresAt?: Date | string | null;
  now: Date;
  durationDays: number;
}): Date {
  const current = asDate(currentExpiresAt);
  const start = current != null && current.getTime() > now.getTime() ? current : now;
  return timePackExpiresAt(start, durationDays);
}

/**
 * Whether this request or usage row belongs to the time-pack Claude path: the entitlement's
 * endpoint, and a model on the pack's allowlist when it has one (an unknown model never matches
 * an allowlist).
 */
export function isTimePackClaudeRequest({
  entitlement,
  endpoint,
  model,
  models,
}: {
  entitlement: TimePackEntitlement | null;
  endpoint?: string | null;
  model?: string | null;
  models?: string[] | null;
}): boolean {
  if (entitlement == null || !endpoint) {
    return false;
  }
  if (endpoint !== entitlement.timePackEndpoint) {
    return false;
  }
  const allow = models ?? entitlement.models;
  if (allow != null && allow.length > 0) {
    return typeof model === 'string' && model !== '' && allow.includes(model);
  }
  return true;
}
