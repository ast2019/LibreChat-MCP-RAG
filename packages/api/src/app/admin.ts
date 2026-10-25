import { SystemRoles } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/**
 * `interface.adminFullAccess`: an ADMIN chats on exactly the interface users get (same model
 * list, no extra panels), but `modelSpecs.enforce` is lifted for them so the agents and tools
 * they build in advanced mode run without a model spec. Role permissions are the other half
 * and are synced at startup by `updateInterfacePermissions`; the client shows them only in
 * the admin's advanced mode.
 */
export function applyAdminFullAccess(config: AppConfig, role?: string): AppConfig {
  if (
    role !== SystemRoles.ADMIN ||
    config.interfaceConfig?.adminFullAccess !== true ||
    config.modelSpecs == null
  ) {
    return config;
  }
  return { ...config, modelSpecs: { ...config.modelSpecs, enforce: false } };
}

/**
 * Drops `adminOnly` model specs for every role but ADMIN. The spec is then absent from the
 * startup config and from the list `modelSpecs.enforce` validates requests against, so another
 * role can neither see nor request it.
 */
export function applyAdminOnlySpecs(config: AppConfig, role?: string): AppConfig {
  const list = config.modelSpecs?.list;
  if (role === SystemRoles.ADMIN || !Array.isArray(list) || !list.some((spec) => spec?.adminOnly)) {
    return config;
  }
  return {
    ...config,
    modelSpecs: { ...config.modelSpecs, list: list.filter((spec) => spec?.adminOnly !== true) },
  } as AppConfig;
}
