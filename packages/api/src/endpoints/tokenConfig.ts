import {
  EModelEndpoint,
  normalizeEndpointName,
  resolveModelCatalogKey,
} from 'librechat-data-provider';
import type {
  TModelTokenomics,
  TTokenConfigMap,
  TModelsConfig,
  TModelSpec,
  TEndpoint,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ResolvedModelRegistry } from '~/endpoints/resolved';
import type { EndpointTokenConfig } from '~/types';
import { aliasTargetsCacheKey, resolvedModels as defaultResolvedModels } from '~/endpoints/resolved';
import { buildTokenConfigMap, type TokenomicsDeps } from '~/endpoints/pricing';
import { getTokenConfigKey } from '~/endpoints/custom/initialize';
import { applyPriceMultiplier } from '~/billing/markup';
import { tokenConfigCache } from '~/cache';

export interface ResolveTokenConfigParams {
  appConfig?: AppConfig;
  /** endpoint → model list, from the resolved models config */
  modelsConfig: TModelsConfig;
  userId: string;
  tenantId?: string | null;
  /** Where observed alias → concrete model ids are read; the process registry by default */
  resolvedModels?: Pick<ResolvedModelRegistry, 'get'>;
}

/** The part of a model spec that names what it runs. */
export interface SpecPresetRef {
  preset?: Pick<TModelSpec['preset'], 'endpoint' | 'model'> | null;
}

/**
 * endpoint (token-config map key) → model ids that a model spec offers. Their prices are
 * public — the same per-token rates users are billed and can see on the price list — so they
 * are sent even when `interface.contextCost` keeps per-chat cost hidden.
 */
export function getSpecModelKeys(
  specs: ReadonlyArray<SpecPresetRef | null | undefined> | undefined,
  map: TTokenConfigMap,
): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  for (const spec of specs ?? []) {
    const model = spec?.preset?.model;
    const endpoint = spec?.preset?.endpoint;
    if (!model || !endpoint) {
      continue;
    }
    const key = resolveModelCatalogKey(endpoint, map);
    let models = keys.get(key);
    if (models == null) {
      models = new Set();
      keys.set(key, models);
    }
    models.add(model);
  }
  return keys;
}

function withoutPricing(tokenomics: TModelTokenomics): TModelTokenomics {
  return tokenomics.context != null ? { context: tokenomics.context } : {};
}

/**
 * Server-side token-config resolution for the `/endpoints/token-config`
 * route. Gathers each custom endpoint's override — a static yaml `tokenConfig`
 * or the cached fetched config — then resolves context windows (and pricing,
 * when `interface.contextCost` is enabled) via {@link buildTokenConfigMap}.
 * Lives in TypeScript so the `/api` controller stays a thin wrapper.
 */
export async function resolveTokenConfigMap(
  {
    appConfig,
    modelsConfig,
    userId,
    tenantId,
    resolvedModels = defaultResolvedModels,
  }: ResolveTokenConfigParams,
  deps: TokenomicsDeps,
): Promise<TTokenConfigMap> {
  const contextCost = appConfig?.interfaceConfig?.contextCost === true;
  const specs = appConfig?.modelSpecs?.list;
  const customEndpoints = (appConfig?.endpoints?.[EModelEndpoint.custom] ?? []) as TEndpoint[];
  const cache = tokenConfigCache();
  const endpointTokenConfigs: Record<string, EndpointTokenConfig | undefined> = {};
  /** endpoint → alias id → the concrete model its catalogue says the alias points to */
  const aliasTargets: Record<string, Record<string, string> | undefined> = {};

  for (const endpointConfig of customEndpoints) {
    /** Models config and the token-config cache key by the normalized name */
    const name = normalizeEndpointName(endpointConfig?.name);
    if (!name) {
      continue;
    }
    /** Shown prices match billed prices: both apply the endpoint's multiplier */
    const multiplier = endpointConfig.priceMultiplier;
    if (endpointConfig.tokenConfig != null) {
      endpointTokenConfigs[name] = applyPriceMultiplier(
        endpointConfig.tokenConfig as EndpointTokenConfig,
        multiplier,
      );
      continue;
    }
    /** Model fetches and chat initialization both store under this key —
     *  user-scoped whenever the fetched config can be user-specific */
    const tokenKey = getTokenConfigKey(endpointConfig, name, userId, tenantId);
    const cached = (await cache.get(tokenKey)) as EndpointTokenConfig | undefined;
    if (cached) {
      endpointTokenConfigs[name] = applyPriceMultiplier(cached, multiplier);
    }
    const targets = (await cache.get(aliasTargetsCacheKey(tokenKey))) as
      | Record<string, string>
      | undefined;
    if (targets) {
      aliasTargets[name] = targets;
    }
  }

  const includePricing = contextCost || (specs?.length ?? 0) > 0;
  const map = buildTokenConfigMap({ modelsConfig, endpointTokenConfigs, includePricing }, deps);
  const specModels = contextCost ? undefined : getSpecModelKeys(specs, map);

  for (const [endpoint, models] of Object.entries(map)) {
    const offered = specModels?.get(endpoint);
    for (const [model, tokenomics] of Object.entries(models)) {
      let entry = tokenomics;
      if (specModels != null && offered?.has(model) !== true) {
        entry = withoutPricing(entry);
      }
      /** What answered on a real response first, else what the catalogue says the alias is */
      const target = aliasTargets[endpoint]?.[model];
      const resolved = resolvedModels.get(model) ?? (typeof target === 'string' ? target : undefined);
      if (resolved != null) {
        entry = { ...entry, resolved };
      }
      if (entry !== tokenomics) {
        models[model] = entry;
      }
    }
  }
  return map;
}
