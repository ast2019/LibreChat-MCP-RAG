import { CREDITS_PER_USD, getRefillEligibilityDate } from 'librechat-data-provider';
import type { BalanceDisplay, BalanceRefillMode, TBalanceResponse } from 'librechat-data-provider';
import type { CurrencyConfig } from './tokens';
import { formatCost } from './tokens';

/** Share of the allotment spent at which the balance reads as running low. */
export const BALANCE_WARNING_PERCENT = 90;

export type BalanceTone = 'normal' | 'warning' | 'danger';

/**
 * One reading of the user's balance. Every surface that shows the balance renders
 * from this, so the gauge popover and the settings dialog cannot disagree.
 */
export interface BalanceSummary {
  display: BalanceDisplay;
  credits: number;
  /** Credits measured against: the last granted pack, else the refill amount under
   *  auto-refill, else the starting balance. */
  allotment: number | null;
  /** Display name of the last granted pack; null when none was granted or it has no name. */
  packLabel: string | null;
  /** Whole percent of the allotment spent, 0–100; 100 once credits run out, else null without
   *  an allotment to measure against. */
  usedPercent: number | null;
  tone: BalanceTone;
  /** Credits the next auto-refill adds; null without auto-refill. */
  refillAmount: number | null;
  refillMode: BalanceRefillMode;
  /** When the next auto-refill becomes eligible; null without auto-refill. */
  nextRefill: Date | null;
  /** `pack` display: no pack granted yet, or the granted one is spent, so the pack prices
   *  are offered beside the reading. */
  showPrices: boolean;
}

interface SummaryOptions {
  display?: BalanceDisplay;
  startBalance?: number;
}

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

function getNextRefill(balance: TBalanceResponse): Date | null {
  const { lastRefill, refillIntervalValue, refillIntervalUnit } = balance;
  if (lastRefill == null || refillIntervalValue == null || refillIntervalUnit == null) {
    return null;
  }
  const last = new Date(lastRefill);
  if (Number.isNaN(last.getTime())) {
    return null;
  }
  return getRefillEligibilityDate(last, refillIntervalValue, refillIntervalUnit);
}

/**
 * Percent spent is floored while credits remain, so a nearly drained balance never
 * reads "100% used" before it is actually empty; an empty balance is fully spent
 * whatever it is measured against.
 */
function getUsedPercent(credits: number, allotment: number | null): number | null {
  if (credits <= 0) {
    return 100;
  }
  if (allotment == null) {
    return null;
  }
  const spent = (1 - credits / allotment) * 100;
  return Math.min(Math.max(Math.floor(spent), 0), 99);
}

export function summarizeBalance(
  balance: TBalanceResponse,
  { display = 'credits', startBalance }: SummaryOptions = {},
): BalanceSummary {
  const credits = Number.isFinite(balance.tokenCredits) ? balance.tokenCredits : 0;
  const refillAmount = balance.autoRefillEnabled ? positive(balance.refillAmount) : null;
  const allotment = positive(balance.packAllotment) ?? refillAmount ?? positive(startBalance);
  const packLabel =
    typeof balance.packLabel === 'string' && balance.packLabel.trim() !== ''
      ? balance.packLabel.trim()
      : null;
  const usedPercent = getUsedPercent(credits, allotment);
  /** `pack` reads as the share of the current allowance used — the free trial before a pack,
   *  the pack after — never as a money amount; money appears only as the packs' prices when
   *  there is one to buy */
  const hasPack = positive(balance.packAllotment) != null;
  const shownDisplay: BalanceDisplay = display === 'pack' ? 'percent' : display;

  let tone: BalanceTone = 'normal';
  if (credits <= 0) {
    tone = 'danger';
  } else if (usedPercent != null && usedPercent >= BALANCE_WARNING_PERCENT) {
    tone = 'warning';
  }

  return {
    display: shownDisplay,
    credits,
    allotment,
    packLabel,
    usedPercent,
    tone,
    refillAmount,
    refillMode: balance.refillMode ?? 'add',
    nextRefill: balance.autoRefillEnabled ? getNextRefill(balance) : null,
    showPrices: display === 'pack' && (!hasPack || credits <= 0),
  };
}

export interface PackRemaining {
  /** Whole percent of the granted pack still left, 0–100 */
  percent: number;
  tone: BalanceTone;
}

/**
 * What is left of the user's granted pack, or null when no pack measures it (the sign-up
 * gift, a trial, auto-refill only), so the account ring never claims a pack the user has
 * not bought.
 */
export function getPackRemaining(
  balance: TBalanceResponse | undefined,
  summary: BalanceSummary | null,
): PackRemaining | null {
  if (balance == null || summary == null || positive(balance.packAllotment) == null) {
    return null;
  }
  if (summary.usedPercent == null) {
    return null;
  }
  return { percent: 100 - summary.usedPercent, tone: summary.tone };
}

/** A credit amount in the configured display: money for `currency` and `pack`, whole
 *  credits otherwise. */
export function formatBalanceAmount(
  credits: number,
  display: BalanceDisplay,
  currency?: CurrencyConfig,
): string {
  if (display === 'currency' || display === 'pack') {
    return formatCost(credits / CREDITS_PER_USD, currency);
  }
  /** Credits are fractional when pricing multipliers are; two places keep a shortfall like
   *  100.4 against 100.3 visible, and whole amounts still print without decimals */
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(credits);
}

/**
 * A pack's sale price: its credits' dollar value in the display currency, rounded up to the
 * currency's `priceStep`, so the user pays at least what the pack is worth. Null without a
 * usable rate, so no price is ever shown under the wrong unit.
 */
/**
 * What a pack is worth in US dollars of usage at the prices users are billed
 * (1,000,000 credits = $1), in the page's digits: `4000000` → `۴` in Persian.
 */
export function formatPackUsd(credits: number, locale?: string): string {
  const usd = (Number.isFinite(credits) ? credits : 0) / CREDITS_PER_USD;
  const lang =
    locale ?? (typeof document !== 'undefined' ? document.documentElement.lang : undefined);
  return new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: 2 }).format(usd);
}

export function formatPackPrice(credits: number, currency?: CurrencyConfig): string | null {
  if (currency == null || !Number.isFinite(currency.rate) || currency.rate <= 0) {
    return null;
  }
  const amount = (credits / CREDITS_PER_USD) * currency.rate;
  const step = currency.priceStep;
  /** The epsilon keeps float noise (540000.0000001) from rounding an exact price up a step */
  const price = step != null && step > 0 ? Math.ceil(amount / step - 1e-9) * step : amount;
  return formatCost(price, { code: currency.code, rate: 1 });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "in 5 minutes" / "in 3 hours" / "in 4 days"; null once the moment has passed. */
export function formatTimeUntil(target: Date, now: number, locale?: string): string | null {
  const remaining = target.getTime() - now;
  if (!(remaining > 0)) {
    return null;
  }
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  if (remaining < HOUR_MS) {
    return format.format(Math.max(1, Math.ceil(remaining / MINUTE_MS)), 'minute');
  }
  if (remaining < 2 * DAY_MS) {
    return format.format(Math.ceil(remaining / HOUR_MS), 'hour');
  }
  return format.format(Math.ceil(remaining / DAY_MS), 'day');
}
