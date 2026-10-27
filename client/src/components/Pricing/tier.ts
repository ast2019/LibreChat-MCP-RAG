import type { TModelTokenomics } from 'librechat-data-provider';

/** ~1000 words of Persian or English prose come to about 1300 tokens. */
export const TOKENS_PER_1000_WORDS = 1300;

/** Input tokens weigh 3:1 against output in a typical chat turn (history and files are
 *  re-sent on every message), the usual weighting for a single blended price. */
const INPUT_WEIGHT = 3;
const OUTPUT_WEIGHT = 1;

/**
 * Upper bounds, in USD per 1M blended tokens with the endpoint's price multiplier applied,
 * of tiers 1–3; anything above the last is tier 4. Roughly: tier 1 the "mini/flash" class,
 * 2 the fast mid models, 3 the flagship models, 4 the top "opus"-class models.
 */
export const COST_TIER_THRESHOLDS: readonly [number, number, number] = [1, 4, 12];

/** 0 is free; 1–4 is cheap to expensive. */
export type CostTier = 0 | 1 | 2 | 3 | 4;

const isRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** USD per 1M tokens of a typical turn, or null when either rate is unknown. */
export function getBlendedPrice(rates?: TModelTokenomics | null): number | null {
  if (!isRate(rates?.prompt) || !isRate(rates?.completion)) {
    return null;
  }
  return (
    (rates.prompt * INPUT_WEIGHT + rates.completion * OUTPUT_WEIGHT) /
    (INPUT_WEIGHT + OUTPUT_WEIGHT)
  );
}

/** The model's cost tier from its rates, or null when its price is unknown. */
export function getCostTier(rates?: TModelTokenomics | null): CostTier | null {
  const blended = getBlendedPrice(rates);
  if (blended == null) {
    return null;
  }
  if (blended === 0) {
    return 0;
  }
  const [cheap, mid, high] = COST_TIER_THRESHOLDS;
  if (blended <= cheap) {
    return 1;
  }
  if (blended <= mid) {
    return 2;
  }
  return blended <= high ? 3 : 4;
}

/** USD for ~1000 words at a per-1M-token rate. */
export function perThousandWords(ratePerMillion: number): number {
  return (ratePerMillion * TOKENS_PER_1000_WORDS) / 1_000_000;
}
