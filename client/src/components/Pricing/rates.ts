import { EModelEndpoint, resolveModelCatalogKey } from 'librechat-data-provider';
import type { TModelSpec, TModelTokenomics, TTokenConfigMap } from 'librechat-data-provider';

/**
 * A spec's entry in the token-config map, joined on its preset's endpoint and model the way
 * `useTokenLimits` does. Agent-backed specs carry no model of their own and resolve to nothing.
 */
export function getSpecTokenomics(
  spec: Pick<TModelSpec, 'preset'> | undefined,
  map: TTokenConfigMap | undefined,
): TModelTokenomics | undefined {
  const endpoint = spec?.preset?.endpoint;
  const model = spec?.preset?.model;
  if (map == null || !endpoint || !model || endpoint === EModelEndpoint.agents) {
    return undefined;
  }
  return map[resolveModelCatalogKey(endpoint, map)]?.[model];
}
