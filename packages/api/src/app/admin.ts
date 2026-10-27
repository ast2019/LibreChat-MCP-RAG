import { SystemRoles, Permissions, PermissionTypes } from 'librechat-data-provider';
import type { AppConfig, RolePermissions } from '@librechat/data-schemas';
import type { TUserModelAccess } from 'librechat-data-provider';

/** Which model privacy classes a principal may use. */
export type PrivacyAccess = { allowLocal: boolean; allowPrivate: boolean };

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

/**
 * Effective access to the `local` and `private` spec classes: ADMIN always has both; otherwise a
 * user override (`true`/`false`) wins over the role permission, and a permission the role does
 * not store counts as granted (the default for both types), so roles that predate them keep today's
 * behavior. `permissions` is `null` when the role could not be read — the role grants nothing then.
 */
export function resolvePrivacyAccess({
  role,
  permissions,
  override,
}: {
  role?: string;
  permissions?: RolePermissions | null;
  override?: TUserModelAccess | null;
}): PrivacyAccess {
  if (role === SystemRoles.ADMIN) {
    return { allowLocal: true, allowPrivate: true };
  }
  const roleAllows = (type: PermissionTypes.LOCAL_MODELS | PermissionTypes.PRIVATE_MODELS) =>
    permissions !== null && permissions?.[type]?.[Permissions.USE] !== false;
  return {
    allowLocal:
      typeof override?.local === 'boolean'
        ? override.local
        : roleAllows(PermissionTypes.LOCAL_MODELS),
    allowPrivate:
      typeof override?.private === 'boolean'
        ? override.private
        : roleAllows(PermissionTypes.PRIVATE_MODELS),
  };
}

/** True when the config lists a spec of a privacy class, i.e. access decides what is shown. */
export function hasPrivacySpecs(config: AppConfig): boolean {
  const list = config.modelSpecs?.list;
  return Array.isArray(list) && list.some((spec) => spec?.privacy != null);
}

/**
 * Drops model specs whose privacy class (`local`, `private`) the principal may not use. Like
 * {@link applyAdminOnlySpecs}, the spec is then absent from the startup config and from the list
 * `modelSpecs.enforce` validates requests against. Endpoints are untouched, so server-side
 * consumers that name an endpoint directly (the memory agent) keep working.
 */
export function applyPrivacyAccessSpecs(config: AppConfig, access: PrivacyAccess): AppConfig {
  const list = config.modelSpecs?.list;
  if ((access.allowLocal && access.allowPrivate) || !Array.isArray(list)) {
    return config;
  }
  const allowed = (spec: (typeof list)[number]) =>
    (spec?.privacy !== 'local' || access.allowLocal) &&
    (spec?.privacy !== 'private' || access.allowPrivate);
  if (list.every(allowed)) {
    return config;
  }
  return {
    ...config,
    modelSpecs: { ...config.modelSpecs, list: list.filter(allowed) },
  } as AppConfig;
}
