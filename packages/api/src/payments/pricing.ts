import type { ResolvedCurrency } from '~/billing/currency';

/** 1,000,000 credits are $1 of marked-up usage. */
const CREDITS_PER_USD = 1_000_000;

/** Rials per unit of a display currency the gateways can charge in. */
const RIALS_PER_UNIT: Record<string, number> = { IRR: 1, IRT: 10 };

/**
 * What a pack costs in rials: the same figure the pack list shows (its credits' dollar value in
 * the display currency, rounded up to `priceStep`), converted to rials. Null when the display
 * currency is not rial/toman or has no usable rate, so nothing is charged under a wrong unit.
 */
export function packPriceRial(
  credits: number,
  currency: ResolvedCurrency | undefined,
): number | null {
  if (currency == null || !(currency.rate > 0) || !Number.isFinite(currency.rate)) {
    return null;
  }
  const perUnit = RIALS_PER_UNIT[currency.code];
  if (perUnit == null || !(credits > 0)) {
    return null;
  }
  const amount = (credits / CREDITS_PER_USD) * currency.rate;
  const step = currency.priceStep;
  /** The epsilon keeps float noise (540000.0000001) from rounding an exact price up a step */
  const price = step != null && step > 0 ? Math.ceil(amount / step - 1e-9) * step : amount;
  /** Gateways take whole rials; a toman price stays a multiple of ten for `IRT` gateways */
  const rial = Math.ceil(price * perUnit - 1e-9);
  return Math.ceil(rial / 10) * 10;
}
