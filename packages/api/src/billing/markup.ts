import type { EndpointTokenConfig } from '~/types';

/**
 * Keys of an endpoint token config that hold USD-per-million-token rates. Both the
 * billing names (`read`/`write`/`write1h`) and the admin-facing static `tokenConfig`
 * names (`cacheRead`/`cacheWrite`/`cacheWrite1h`) are rates; `context` is a window size.
 */
const RATE_KEYS: ReadonlySet<string> = new Set([
  'prompt',
  'completion',
  'read',
  'write',
  'write1h',
  'cacheRead',
  'cacheWrite',
  'cacheWrite1h',
]);

/** True for a multiplier that changes prices: finite, positive and not exactly 1. */
export function isEffectivePriceMultiplier(multiplier: unknown): multiplier is number {
  return (
    typeof multiplier === 'number' &&
    Number.isFinite(multiplier) &&
    multiplier > 0 &&
    multiplier !== 1
  );
}

/**
 * Returns a copy of `config` with every rate scaled by `multiplier`, so users are billed
 * the provider's USD price plus the deployment's margin. Context windows and unknown keys
 * are kept as-is. The input is never mutated, because it is usually the shared cached
 * config that other requests read too. A missing config or a neutral multiplier
 * returns the input unchanged.
 */
export function applyPriceMultiplier(
  config: EndpointTokenConfig | undefined,
  multiplier: number | undefined,
): EndpointTokenConfig | undefined {
  if (config == null || !isEffectivePriceMultiplier(multiplier)) {
    return config;
  }
  const result: EndpointTokenConfig = {};
  for (const [model, rates] of Object.entries(config)) {
    const scaled = { ...rates };
    for (const [key, value] of Object.entries(rates)) {
      if (RATE_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        scaled[key] = value * multiplier;
      }
    }
    result[model] = scaled;
  }
  return result;
}
