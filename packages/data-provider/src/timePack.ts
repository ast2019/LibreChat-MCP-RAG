import type { TBalancePack, TTimePackRuntime } from './config';
import {
  DEFAULT_TIME_PACK_MAX_SEATS,
  DEFAULT_TIME_PACK_MAX_SEATS_PER_USER,
  DEFAULT_TIME_PACK_OVERSELL_MIN_METERED_CREDITS,
  DEFAULT_TIME_PACK_REST_MINUTES,
  DEFAULT_TIME_PACK_USAGE_WINDOW_HOURS,
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

/** Whether this request should use the time-pack Claude path. */
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
  if (allow != null && allow.length > 0 && model) {
    return allow.includes(model);
  }
  return true;
}
