import {
  Permissions,
  SystemRoles,
  findPackGrants,
  PermissionTypes,
  resolveApiAccess,
  resolveMediaAccess,
  resolveBrowserAccess,
  resolveModelClassAccess,
} from 'librechat-data-provider';
import type { TPackGrants, TUserModelAccess, TEffectiveAccessMap } from 'librechat-data-provider';
import type { RolePermissions } from '@librechat/data-schemas';

/** What a role allows of each class when neither a user override nor a pack decides. */
export interface RoleAccess {
  local: boolean;
  private: boolean;
  api: boolean;
}

/** The rules that apply without overrides: the configured packs and the media `paidOnly`. */
export interface AccessRules {
  packs?: ReadonlyArray<{ id?: string; grants?: TPackGrants }> | null;
  mediaPaidOnly: boolean;
}

/**
 * A role's access, read the way enforcement reads it: a local/private permission the role does
 * not store counts as granted (`resolvePrivacyAccess`), the API needs `REMOTE_AGENTS.USE`
 * (`generateCheckAccess`), and an unreadable role (`null`) grants nothing.
 */
export function roleAccessFromPermissions(
  permissions: RolePermissions | null | undefined,
): RoleAccess {
  if (permissions === null) {
    return { local: false, private: false, api: false };
  }
  return {
    local: permissions?.[PermissionTypes.LOCAL_MODELS]?.[Permissions.USE] !== false,
    private: permissions?.[PermissionTypes.PRIVATE_MODELS]?.[Permissions.USE] !== false,
    api: permissions?.[PermissionTypes.REMOTE_AGENTS]?.[Permissions.USE] === true,
  };
}

export interface EffectiveAccessUser {
  role: string;
  modelAccess?: TUserModelAccess;
  apiAccess?: boolean;
  mediaAccess?: boolean;
  browserAccess?: boolean;
  /** `user.packId`, which local, private and API enforcement read from the loaded user */
  packId?: string;
  /** The balance pack, which media enforcement reads */
  balance?: { packId?: string } | null;
}

/**
 * What each class resolves to for this user now, and who decided it — the same shared rules
 * (`resolveModelClassAccess`, `resolveApiAccess`, `resolveMediaAccess`, `resolveBrowserAccess`) the request paths apply.
 */
export function computeEffectiveAccess(
  user: EffectiveAccessUser,
  rules: AccessRules,
  role: RoleAccess,
): TEffectiveAccessMap {
  const isAdmin = user.role === SystemRoles.ADMIN;
  const userGrants = findPackGrants(rules.packs, user.packId);
  const balancePackId = user.balance?.packId;
  return {
    local: resolveModelClassAccess({
      isAdmin,
      override: user.modelAccess?.local,
      packGrant: userGrants?.local,
      roleAllows: role.local,
    }),
    private: resolveModelClassAccess({
      isAdmin,
      override: user.modelAccess?.private,
      packGrant: userGrants?.private,
      roleAllows: role.private,
    }),
    api: resolveApiAccess({
      override: user.apiAccess,
      packGrant: userGrants?.api,
      roleAllows: role.api,
    }),
    media: resolveMediaAccess({
      override: user.mediaAccess,
      isAdmin,
      paidOnly: rules.mediaPaidOnly,
      hasPack: Boolean(balancePackId),
      packGrant: findPackGrants(rules.packs, balancePackId)?.media,
    }),
    browser: resolveBrowserAccess({
      isAdmin,
      override: user.browserAccess,
      packGrant: userGrants?.browser,
    }),
  };
}
