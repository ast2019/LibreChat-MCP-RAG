import { useMemo } from 'react';
import type { TModelSpec, TModelTokenomics } from 'librechat-data-provider';
import type { CostTier } from './tier';
import { useTokenConfigQuery } from '~/data-provider';
import { getSpecTokenomics } from './rates';
import { getCostTier } from './tier';

export interface SpecPricing {
  rates?: TModelTokenomics;
  /** Null when the price is unknown */
  tier: CostTier | null;
  /** Concrete model id the spec's alias last answered as; only ever an observed id */
  resolved?: string;
}

/** Price tier and observed model version of one spec, from the shared token-config query. */
export default function useSpecPricing(spec: Pick<TModelSpec, 'preset'>): SpecPricing {
  const { data: tokenConfig } = useTokenConfigQuery();
  return useMemo(() => {
    const rates = getSpecTokenomics(spec, tokenConfig);
    return { rates, tier: getCostTier(rates), resolved: rates?.resolved };
  }, [spec, tokenConfig]);
}
