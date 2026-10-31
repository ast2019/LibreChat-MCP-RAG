import {
  SystemRoles,
  Permissions,
  PermissionTypes,
  resolveModelClassAccess,
} from 'librechat-data-provider';
import type { AppConfig, RolePermissions } from '@librechat/data-schemas';
import type { TPackGrants, TUserModelAccess } from 'librechat-data-provider';

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
 * Effective access to the `local` and `private` spec classes, per class: ADMIN always has both;
 * otherwise a user override (`true`/`false`) wins, then the current pack's `grants`, then the role
 * permission. A permission the role does not store counts as granted (the default for both
 * types), so roles that predate them keep today's behavior. `permissions` is `null` when the role
 * could not be read — the role grants nothing then.
 */
export function resolvePrivacyAccess({
  role,
  permissions,
  override,
  packGrants,
}: {
  role?: string;
  permissions?: RolePermissions | null;
  override?: TUserModelAccess | null;
  packGrants?: TPackGrants;
}): PrivacyAccess {
  const isAdmin = role === SystemRoles.ADMIN;
  const roleAllows = (type: PermissionTypes.LOCAL_MODELS | PermissionTypes.PRIVATE_MODELS) =>
    permissions !== null && permissions?.[type]?.[Permissions.USE] !== false;
  return {
    allowLocal: resolveModelClassAccess({
      isAdmin,
      override: override?.local,
      packGrant: packGrants?.local,
      roleAllows: roleAllows(PermissionTypes.LOCAL_MODELS),
    }).allowed,
    allowPrivate: resolveModelClassAccess({
      isAdmin,
      override: override?.private,
      packGrant: packGrants?.private,
      roleAllows: roleAllows(PermissionTypes.PRIVATE_MODELS),
    }).allowed,
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
