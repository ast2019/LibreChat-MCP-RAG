import { packPriceRial as sharedPackPriceRial } from 'librechat-data-provider';
import type { ResolvedCurrency } from '~/billing/currency';

/**
 * What a pack costs in rials: the same figure the pack list shows (its credits' dollar value in
 * the display currency, rounded up to `priceStep`), converted to rials. Null when the display
 * currency is not rial/toman or has no usable rate, so nothing is charged under a wrong unit.
 *
 * The amount math lives in `librechat-data-provider` so the client label and this charge cannot
 * drift.
 */
export function packPriceRial(
  credits: number,
  currency: ResolvedCurrency | undefined,
): number | null {
  return sharedPackPriceRial(credits, currency);
}
