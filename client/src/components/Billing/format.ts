import { CREDITS_PER_USD } from 'librechat-data-provider';

/** Credits (micro-dollars of billed usage) as US dollars. */
export function formatUsd(credits: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format((Number.isFinite(credits) ? credits : 0) / CREDITS_PER_USD);
}

/** The rial value of `credits` at `rialPerUsd`; null when no rate is available. */
export function creditsToRial(
  credits: number,
  rialPerUsd: number | null | undefined,
): number | null {
  if (rialPerUsd == null || !Number.isFinite(rialPerUsd) || rialPerUsd <= 0) {
    return null;
  }
  return ((Number.isFinite(credits) ? credits : 0) / CREDITS_PER_USD) * rialPerUsd;
}
