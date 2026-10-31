import type {
  TAccessClass,
  TAdminBillingPack,
  TAdminBillingUser,
  TEffectiveAccess,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type useLocalize from '~/hooks/useLocalize';

/** The admin's name for each access class, full and short (for the table's summary chips). */
export const ACCESS_LABELS: Record<
  TAccessClass,
  { full: TranslationKeys; short: TranslationKeys }
> = {
  local: { full: 'com_admin_model_access_local', short: 'com_admin_access_short_local' },
  private: { full: 'com_admin_model_access_private', short: 'com_admin_access_short_private' },
  media: { full: 'com_admin_media_access', short: 'com_admin_access_short_media' },
  api: { full: 'com_admin_api_access', short: 'com_admin_access_short_api' },
};

/** The user's own override of a class: `true`, `false`, or `undefined` when the default applies. */
export function overrideOf(user: TAdminBillingUser, field: TAccessClass): boolean | undefined {
  if (field === 'local' || field === 'private') {
    return user.modelAccess?.[field];
  }
  return field === 'api' ? user.apiAccess : user.mediaAccess;
}

/** The pack that decides a class: `user.packId` for local, private and API, the balance's for media. */
export function decidingPack(
  user: TAdminBillingUser,
  field: TAccessClass,
  packs: readonly TAdminBillingPack[],
): { id: string; label: string } | null {
  const id = field === 'media' ? user.balance?.packId : user.packId;
  if (!id) {
    return null;
  }
  const pack = packs.find((item) => item.id === id);
  return { id, label: pack?.label || user.balance?.packLabel || id };
}

type Localize = ReturnType<typeof useLocalize>;

/** Who decided an access class, in a sentence for the admin. */
export function describeSource(
  localize: Localize,
  access: TEffectiveAccess,
  pack: { label: string } | null,
): string {
  switch (access.source) {
    case 'user':
      return localize('com_admin_access_source_user');
    case 'admin':
      return localize('com_admin_access_source_admin');
    case 'pack':
      return localize('com_admin_access_source_pack', { 0: pack?.label ?? '' });
    case 'role':
      return localize('com_admin_access_source_role');
    default:
      return localize(
        access.allowed ? 'com_admin_access_source_rule_on' : 'com_admin_access_source_rule_off',
      );
  }
}

/** The classes a pack grants and withholds, for the grant dialog. */
export function describePackGrants(
  localize: Localize,
  pack: TAdminBillingPack,
): { granted: string[]; withheld: string[] } {
  const granted: string[] = [];
  const withheld: string[] = [];
  for (const [field, labels] of Object.entries(ACCESS_LABELS) as [
    TAccessClass,
    (typeof ACCESS_LABELS)[TAccessClass],
  ][]) {
    const value = pack.grants?.[field];
    if (value === true) {
      granted.push(localize(labels.full));
    } else if (value === false) {
      withheld.push(localize(labels.full));
    }
  }
  return { granted, withheld };
}
