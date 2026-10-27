import { memo } from 'react';
import type { SpecPricing } from './useSpecPricing';
import type { CurrencyConfig } from '~/utils';
import { getBlendedPrice, perThousandWords } from './tier';
import useLocalize from '~/hooks/useLocalize';
import { formatCost } from '~/utils/tokens';
import { formatModelName } from './name';

interface SpecMetaProps {
  /** Observed concrete model id of the spec's alias */
  resolved?: string;
  /** From {@link useThousandWordsPrice} */
  price?: string | null;
}

/** The price of ~1000 words of a typical exchange in the display currency, or null. */
export function useThousandWordsPrice(
  pricing: SpecPricing,
  currency?: CurrencyConfig,
): string | null {
  const localize = useLocalize();
  const blended = getBlendedPrice(pricing.rates);
  if (blended == null || blended === 0) {
    return null;
  }
  return localize('com_ui_price_per_1000_words', {
    0: formatCost(perThousandWords(blended), currency),
  });
}

/** Under a model-spec description: the observed model version and the price of ~1000 words. */
function SpecMeta({ resolved, price }: SpecMetaProps) {
  const localize = useLocalize();
  if (resolved == null && price == null) {
    return null;
  }
  return (
    <span className="text-text-secondary flex flex-wrap items-center gap-x-2 text-xs font-normal">
      {resolved != null && (
        <span title={resolved} data-testid="spec-resolved-model">
          {localize('com_ui_model_current_version', { 0: formatModelName(resolved) })}
        </span>
      )}
      {price != null && <span data-testid="spec-price">{price}</span>}
    </span>
  );
}

export default memo(SpecMeta);
