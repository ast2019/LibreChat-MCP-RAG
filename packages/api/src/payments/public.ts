import type { TPublicPack } from 'librechat-data-provider';
import type { BalanceLike } from './service';
import { sellablePacks } from './service';

/** Pack classes worth naming on the public page (Attached VM and Higgsfield are admin-granted). */
const PUBLIC_PACK_CLASSES: TPublicPack['includes'] = [
  'local',
  'private',
  'media',
  'api',
  'browser',
];

/**
 * The packs of `GET /api/config/packs`: exactly the packs checkout sells (no time packs, no
 * pack without whole credits), with only what the purchase page shows — never the admin note.
 */
export function getPublicPacks(balance: BalanceLike): TPublicPack[] {
  if (balance?.enabled !== true) {
    return [];
  }
  return sellablePacks(balance).map((pack) => {
    const includes = PUBLIC_PACK_CLASSES.filter((key) => pack.grants?.[key] === true);
    return {
      id: pack.id,
      label: pack.label,
      credits: pack.credits,
      includes,
      ...(includes.includes('browser') && pack.browserSessions != null
        ? { browserSessions: pack.browserSessions }
        : {}),
    };
  });
}
