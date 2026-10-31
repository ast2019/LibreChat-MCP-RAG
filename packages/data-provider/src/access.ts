import { z } from 'zod';

/**
 * The per-user access classes an admin manages: local and private model specs, media generation
 * (image, video, speech, Higgsfield) and the programming API.
 */
export type TAccessClass = 'local' | 'private' | 'media' | 'api';

export const ACCESS_CLASSES: readonly TAccessClass[] = ['local', 'private', 'media', 'api'];

/**
 * What a balance pack grants (`true`) or withholds (`false`) while it is the user's current
 * pack. An omitted class keeps the rule without packs: the role for local, private and API
 * access, and "any pack" for media.
 */
export const packGrantsSchema = z
  .object({
    local: z.boolean().optional(),
    private: z.boolean().optional(),
    media: z.boolean().optional(),
    api: z.boolean().optional(),
  })
  .strict();

export type TPackGrants = z.infer<typeof packGrantsSchema>;

/**
 * Who decided an access class, in the order they are consulted: the user's own override,
 * the admin role, the current pack, the role's permission, or the deployment rule.
 */
export type TAccessSource = 'user' | 'admin' | 'pack' | 'role' | 'rule';

export type TEffectiveAccess = { allowed: boolean; source: TAccessSource };

export type TEffectiveAccessMap = Record<TAccessClass, TEffectiveAccess>;

/** The grants of the pack `packId` names; `undefined` for no pack, `custom`, or an unknown id. */
export function findPackGrants(
  packs: ReadonlyArray<{ id?: string; grants?: TPackGrants }> | null | undefined,
  packId: string | null | undefined,
): TPackGrants | undefined {
  if (!packId || !packs) {
    return undefined;
  }
  return packs.find((pack) => pack.id === packId)?.grants;
}

const decided = (value: unknown): value is boolean => typeof value === 'boolean';

/** Local or private model specs: admin (always), then user override, then pack, then role. */
export function resolveModelClassAccess({
  isAdmin,
  override,
  packGrant,
  roleAllows,
}: {
  isAdmin: boolean;
  override?: boolean | null;
  packGrant?: boolean;
  roleAllows: boolean;
}): TEffectiveAccess {
  if (isAdmin) {
    return { allowed: true, source: 'admin' };
  }
  if (decided(override)) {
    return { allowed: override, source: 'user' };
  }
  if (decided(packGrant)) {
    return { allowed: packGrant, source: 'pack' };
  }
  return { allowed: roleAllows, source: 'role' };
}

/** The programming API: user override, then pack, then the role's permission. */
export function resolveApiAccess({
  override,
  packGrant,
  roleAllows,
}: {
  override?: boolean | null;
  packGrant?: boolean;
  roleAllows: boolean;
}): TEffectiveAccess {
  if (decided(override)) {
    return { allowed: override, source: 'user' };
  }
  if (decided(packGrant)) {
    return { allowed: packGrant, source: 'pack' };
  }
  return { allowed: roleAllows, source: 'role' };
}

/**
 * Media generation: user override, then admin, then the pack's grant, then the deployment rule
 * (`paidOnly: false` opens it to everyone), then whether the user has any pack.
 */
export function resolveMediaAccess({
  override,
  isAdmin,
  paidOnly,
  hasPack,
  packGrant,
}: {
  override?: boolean | null;
  isAdmin: boolean;
  paidOnly: boolean;
  hasPack: boolean;
  packGrant?: boolean;
}): TEffectiveAccess {
  if (decided(override)) {
    return { allowed: override, source: 'user' };
  }
  if (isAdmin) {
    return { allowed: true, source: 'admin' };
  }
  if (decided(packGrant)) {
    return { allowed: packGrant, source: 'pack' };
  }
  if (!paidOnly) {
    return { allowed: true, source: 'rule' };
  }
  return hasPack ? { allowed: true, source: 'pack' } : { allowed: false, source: 'rule' };
}
