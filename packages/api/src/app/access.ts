import { SystemRoles } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/** Interface switches an unrestricted admin always gets; `mascot` is branding and stays as set. */
const ADMIN_INTERFACE = {
  modelSelect: true,
  parameters: true,
  presets: true,
  multiConvo: true,
  contextUsage: true,
  contextCost: true,
  buildInfo: true,
} as const;

/** Whether `interface.adminFullAccess` lifts the interface restrictions for `role`. */
export function hasAdminFullAccess(appConfig: AppConfig, role?: string | null): boolean {
  return role === SystemRoles.ADMIN && appConfig.config?.interface?.adminFullAccess === true;
}

/**
 * With `interface.adminFullAccess`, gives the ADMIN role the raw model selector, parameters,
 * presets, side-by-side chats, context usage and build info, and stops enforcing model specs
 * (the list and `prioritize` stay, so specs still show). Returns `appConfig` itself for every
 * other role, or when the flag is off; never mutates it, since it may be a cached config.
 */
export function applyAdminFullAccess(appConfig: AppConfig, role?: string | null): AppConfig {
  if (!hasAdminFullAccess(appConfig, role)) {
    return appConfig;
  }
  return {
    ...appConfig,
    interfaceConfig: { ...appConfig.interfaceConfig, ...ADMIN_INTERFACE },
    modelSpecs: appConfig.modelSpecs && { ...appConfig.modelSpecs, enforce: false },
  };
}
