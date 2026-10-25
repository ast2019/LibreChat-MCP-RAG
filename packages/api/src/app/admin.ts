import { SystemRoles } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/**
 * `interface.adminFullAccess`: an ADMIN reads the deployment with the model selector, the
 * parameters panel and presets on, and with `modelSpecs.enforce` lifted so the endpoints the
 * selector offers are accepted server-side. Users keep the config as resolved. Role permissions
 * are the other half and are synced at startup by `updateInterfacePermissions`.
 */
export function applyAdminFullAccess(config: AppConfig, role?: string): AppConfig {
  if (role !== SystemRoles.ADMIN || config.interfaceConfig?.adminFullAccess !== true) {
    return config;
  }
  return {
    ...config,
    interfaceConfig: {
      ...config.interfaceConfig,
      modelSelect: true,
      parameters: true,
      presets: true,
    },
    ...(config.modelSpecs != null && {
      modelSpecs: { ...config.modelSpecs, enforce: false },
    }),
  };
}
