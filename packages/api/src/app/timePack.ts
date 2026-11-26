import {
  isTimePack,
  getActiveTimePackEntitlement,
  normalizeEndpointName,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getBalanceConfig } from './config';

/**
 * The ClaudeTime plan lives on a dedicated endpoint that only its holders may see.
 *
 * The endpoint and its model list are part of the configuration every signed-in user reads, so
 * without this filter a user without the plan could still pick the endpoint from the endpoint
 * menu and call the gateway directly. The admission refuses such a call, but a menu that offers
 * what the server refuses is a leak of the plan's shape, not of its access.
 */

export type TimePackUserLike = {
  timePackId?: string | null;
  timePackExpiresAt?: Date | string | null;
  timePackEndpoint?: string | null;
};

/** The names of the endpoints that belong to a time pack, normalized as the config keys them. */
export function timePackEndpointNames(config?: AppConfig | null): string[] {
  const packs = getBalanceConfig(config ?? undefined)?.packs ?? [];
  const names = new Set<string>();
  for (const pack of packs) {
    if (!isTimePack(pack)) {
      continue;
    }
    const endpoint = pack.endpoint?.trim();
    if (endpoint) {
      names.add(normalizeEndpointName(endpoint));
    }
  }
  /**
   * Specs with `timePack: true` name the plan's endpoint too. When a pack row omits `endpoint`
   * (or an older config only tagged the specs), the model filter must still leave that endpoint's
   * catalog alone — otherwise every Claude id on it is stripped and chat fails with
   * `illegal_model_request`.
   */
  for (const spec of config?.modelSpecs?.list ?? []) {
    if (spec?.timePack !== true) {
      continue;
    }
    const endpoint =
      typeof spec.preset?.endpoint === 'string' ? spec.preset.endpoint.trim() : '';
    if (endpoint) {
      names.add(normalizeEndpointName(endpoint));
    }
  }
  return [...names];
}

/** Whether the user holds an active time-pack entitlement right now. */
export function hasActiveTimePack(user?: TimePackUserLike | null): boolean {
  return getActiveTimePackEntitlement(user ?? undefined) != null;
}

/**
 * Whether the model id belongs to the time pack's provider family, so a holder of the plan does
 * not see the credit-path version of the same model in another endpoint's list.
 */
export function isTimePackFamilyModel(model: string): boolean {
  return /(^|\/)claude/i.test(model);
}

/**
 * The models of one endpoint as a holder of the plan should see them: the credit-path Claude
 * models are dropped, because the plan serves the same family without credit spend and two
 * menus with the same models in them invite the more expensive one.
 */
export function filterModelsForTimePack(
  models: string[],
  {
    endpointName,
    timePackEndpoints,
    active,
  }: {
    endpointName: string;
    timePackEndpoints: Set<string>;
    active: boolean;
  },
): string[] {
  if (!active || timePackEndpoints.has(endpointName)) {
    return models;
  }
  return models.filter((model) => !isTimePackFamilyModel(model));
}
