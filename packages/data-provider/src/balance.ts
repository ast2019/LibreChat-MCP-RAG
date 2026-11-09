import type { TBalanceResponse } from './types';

export const REFILL_INTERVAL_UNITS = [
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
] as const;

export const BALANCE_REFILL_MODES = ['add', 'reset'] as const;

export type BalanceRefillMode = (typeof BALANCE_REFILL_MODES)[number];

export type RefillIntervalUnit = (typeof REFILL_INTERVAL_UNITS)[number];

/** How the UI presents a balance: raw credits, their currency value, the share of the
 *  period's allotment already spent, or `pack`: the share spent and the pack prices until a
 *  pack is granted, then the remaining currency value. */
export const BALANCE_DISPLAY_MODES = ['credits', 'currency', 'percent', 'pack'] as const;

export type BalanceDisplay = (typeof BALANCE_DISPLAY_MODES)[number];

/** Token credits per US dollar: transaction rates are USD per million tokens. */
export const CREDITS_PER_USD = 1_000_000;

/**
 * Credit ceilings by surface. They differ on purpose: a gift is a small automatic credit, a pack
 * is a priced product an admin publishes, and a manual grant is a rare one-off top-up.
 * - `MAX_GIFT_CREDITS`: sign-up / referral gifts ($100)
 * - `MAX_PACK_CREDITS`: largest catalog pack ($1,000)
 * - `MAX_GRANT_CREDITS`: one admin grant ($100,000), a mistype guard
 */
export const MAX_GIFT_CREDITS = 100_000_000;
export const MAX_PACK_CREDITS = 1_000_000_000;
export const MAX_GRANT_CREDITS = 100_000_000_000;

/** Rials per unit of a display currency the gateways can charge in. */
export const RIALS_PER_DISPLAY_UNIT: Readonly<Record<string, number>> = { IRR: 1, IRT: 10 };

/**
 * A pack's sale amount in the display currency: credits' dollar value × rate, rounded up to
 * `priceStep` when set. Shared by the client price label and the server rial charge so they
 * cannot drift.
 */
export function packSaleAmount(credits: number, rate: number, priceStep?: number): number {
  const amount = (credits / CREDITS_PER_USD) * rate;
  /** The epsilon keeps float noise (540000.0000001) from rounding an exact price up a step */
  if (priceStep != null && priceStep > 0) {
    return Math.ceil(amount / priceStep - 1e-9) * priceStep;
  }
  return amount;
}

/**
 * What a pack costs in rials: the shared display amount, converted to rials and rounded up to a
 * multiple of ten (gateways take whole rials; a toman price stays a multiple of ten). Null when
 * the display currency is not rial/toman or has no usable rate.
 */
export function packPriceRial(
  credits: number,
  currency: { code: string; rate: number; priceStep?: number } | undefined,
): number | null {
  if (currency == null || !(currency.rate > 0) || !Number.isFinite(currency.rate)) {
    return null;
  }
  const perUnit = RIALS_PER_DISPLAY_UNIT[currency.code];
  if (perUnit == null || !(credits > 0)) {
    return null;
  }
  const price = packSaleAmount(credits, currency.rate, currency.priceStep);
  const rial = Math.ceil(price * perUnit - 1e-9);
  return Math.ceil(rial / 10) * 10;
}

/** How long an unreleased in-flight balance reservation keeps counting against the balance. */
export const DEFAULT_BALANCE_RESERVATION_TTL_MS = 30 * 60 * 1000;
/** Shortest reservation TTL; a live reservation is renewed every half TTL. */
export const MIN_BALANCE_RESERVATION_TTL_MS = 10 * 1000;

function ensureExhaustive(value: never): void {
  void value;
}

export function getRefillEligibilityDate(
  lastRefill: Date,
  value: number,
  unit: RefillIntervalUnit,
): Date {
  const result = new Date(lastRefill);
  switch (unit) {
    case 'seconds':
      result.setSeconds(result.getSeconds() + value);
      return result;
    case 'minutes':
      result.setMinutes(result.getMinutes() + value);
      return result;
    case 'hours':
      result.setHours(result.getHours() + value);
      return result;
    case 'days':
      result.setDate(result.getDate() + value);
      return result;
    case 'weeks':
      result.setDate(result.getDate() + value * 7);
      return result;
    case 'months':
      result.setMonth(result.getMonth() + value);
      return result;
    default: {
      ensureExhaustive(unit);
      return result;
    }
  }
}

/** Whether the configured refill/reset period has elapsed. */
export function isBalanceRefillDue(
  record: Pick<
    TBalanceResponse,
    | 'refillMode'
    | 'autoRefillEnabled'
    | 'refillAmount'
    | 'lastRefill'
    | 'refillIntervalValue'
    | 'refillIntervalUnit'
  >,
  now: Date,
): boolean {
  if (!record.autoRefillEnabled || !(record.refillAmount != null && record.refillAmount > 0)) {
    return false;
  }
  if (
    record.refillMode === 'reset' &&
    !(
      record.refillIntervalValue != null &&
      Number.isInteger(record.refillIntervalValue) &&
      record.refillIntervalValue > 0
    )
  ) {
    return false;
  }
  const lastRefill = new Date(record.lastRefill ?? 0);
  if (isNaN(lastRefill.getTime())) {
    return true;
  }
  const eligibleAt = getRefillEligibilityDate(
    lastRefill,
    record.refillIntervalValue ?? 0,
    record.refillIntervalUnit ?? 'days',
  );
  // Date setters can round a fractional interval down to the same instant.
  return (record.refillMode !== 'reset' || eligibleAt > lastRefill) && now >= eligibleAt;
}
