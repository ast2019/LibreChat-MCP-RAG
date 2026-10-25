import { CREDITS_PER_USD } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import { formatCost } from '~/utils/tokens';

/** Credits (micro-dollars of billed usage) as US dollars. */
export function formatUsd(credits: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format((Number.isFinite(credits) ? credits : 0) / CREDITS_PER_USD);
}

/** Credits in the deployment's display currency (e.g. Toman); null when none is configured or
 *  it is US dollars already, so admin views show the second figure only when it adds one. */
export function formatLocal(credits: number, currency?: CurrencyConfig): string | null {
  if (currency == null || currency.code.toUpperCase() === 'USD') {
    return null;
  }
  const value = Number.isFinite(credits) ? credits : 0;
  /** formatCost floors negatives to zero; a negative margin keeps its sign here */
  const formatted = formatCost(Math.abs(value) / CREDITS_PER_USD, currency);
  return value < 0 ? `-${formatted}` : formatted;
}
