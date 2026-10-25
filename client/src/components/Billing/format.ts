import { CREDITS_PER_USD } from 'librechat-data-provider';

/** Credits (micro-dollars of billed usage) as US dollars. */
export function formatUsd(credits: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format((Number.isFinite(credits) ? credits : 0) / CREDITS_PER_USD);
}
