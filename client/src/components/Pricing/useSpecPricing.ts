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
  /** Concrete model id the spec runs: what its alias last answered as or what the provider's
   *  catalogue says the alias points to, else the spec's own model when that is already a
   *  concrete provider id (`google/gemini-3.8-flash`) */
  resolved?: string;
}

/** A provider id that names one model version, as opposed to an OpenRouter `~…` alias or a
 *  bare local name such as `hivegpt-local`. */
const isConcreteModelId = (model?: string | null): model is string =>
  model != null && model.includes('/') && !model.startsWith('~');

/** Price tier and model version of one spec, from the shared token-config query. */
export default function useSpecPricing(spec: Pick<TModelSpec, 'preset'>): SpecPricing {
  const { data: tokenConfig } = useTokenConfigQuery();
  return useMemo(() => {
    const rates = getSpecTokenomics(spec, tokenConfig);
    const model = spec.preset?.model;
    const resolved = rates?.resolved ?? (isConcreteModelId(model) ? model : undefined);
    return { rates, tier: getCostTier(rates), resolved };
  }, [spec, tokenConfig]);
}
