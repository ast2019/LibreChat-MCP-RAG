import { isTimePack, TIME_METER_CONTEXT } from 'librechat-data-provider';
import type { TBalancePack } from 'librechat-data-provider';

export { TIME_METER_CONTEXT };

export type TimePackGrantErrorCode =
  | 'grant_target_required'
  | 'pack_not_found'
  | 'time_pack_invalid';

export type TimePackGrantResolution =
  | {
      ok: true;
      value: {
        pack: TBalancePack;
        durationDays: number;
        endpoint: string;
        models?: string[];
      };
    }
  | { ok: false; error: { code: TimePackGrantErrorCode; message: string } };

/** Resolves a configured `kind: time` pack for an admin grant. */
export function resolveTimePackGrant(
  packs: readonly TBalancePack[] | undefined,
  packId: unknown,
): TimePackGrantResolution {
  if (typeof packId !== 'string' || packId === '') {
    return {
      ok: false,
      error: { code: 'grant_target_required', message: 'Send packId for a time pack grant' },
    };
  }
  const pack = packs?.find((entry) => entry.id === packId);
  if (!pack || !isTimePack(pack)) {
    return {
      ok: false,
      error: { code: 'pack_not_found', message: 'No configured time pack has that id' },
    };
  }
  const durationDays = pack.durationDays;
  const endpoint = typeof pack.endpoint === 'string' ? pack.endpoint.trim() : '';
  if (!(typeof durationDays === 'number' && durationDays >= 1) || endpoint === '') {
    return {
      ok: false,
      error: {
        code: 'time_pack_invalid',
        message: 'Time pack is missing durationDays or endpoint',
      },
    };
  }
  return {
    ok: true,
    value: {
      pack,
      durationDays,
      endpoint,
      ...(pack.models != null && pack.models.length > 0 && { models: [...pack.models] }),
    },
  };
}

export type TimePackFields = {
  timePackId: string;
  timePackLabel: string;
  timePackExpiresAt: Date;
  timePackGrantedAt: Date;
  timePackEndpoint: string;
};

/** The fields a grant left on the balance record; the revision orders copies onto the user. */
export type GrantedTimePackFields = TimePackFields & { timePackRevision: number };

export type TimePackExtension = {
  timePackId: string;
  timePackLabel: string;
  timePackEndpoint: string;
  durationDays: number;
  now: Date;
};

export interface GrantTimePackDeps {
  /**
   * Records the grant on the balance record in one atomic write (data-schemas
   * `extendBalanceTimePack`): a re-grant on the same endpoint before expiry adds `durationDays`
   * to the stored expiry, so concurrent grants each keep their days.
   */
  extendTimePack: (user: string, grant: TimePackExtension) => Promise<GrantedTimePackFields>;
  /**
   * Copies the granted fields onto the user document (data-schemas `setUserTimePack`), applied
   * only over an older revision, and invalidates the cached auth user.
   */
  setUserTimePack?: (user: string, fields: GrantedTimePackFields) => Promise<unknown>;
  now?: () => Date;
}

export interface GrantTimePackResult {
  pack: { id: string; label: string };
  expiresAt: Date;
  endpoint: string;
  grantedAt: Date;
}

/**
 * Records a Claude time entitlement without touching token credits or the credit pack id. A
 * re-grant before expiry on the same endpoint adds `durationDays` to the current expiry.
 */
export async function grantTimePack(
  deps: GrantTimePackDeps,
  {
    userId,
    pack,
    durationDays,
    endpoint,
  }: {
    userId: string;
    pack: TBalancePack;
    durationDays: number;
    endpoint: string;
  },
): Promise<GrantTimePackResult> {
  const now = (deps.now ?? (() => new Date()))();
  const granted = await deps.extendTimePack(userId, {
    timePackId: pack.id,
    timePackLabel: pack.label,
    timePackEndpoint: endpoint,
    durationDays,
    now,
  });
  await deps.setUserTimePack?.(userId, granted);
  return {
    pack: { id: pack.id, label: pack.label },
    expiresAt: granted.timePackExpiresAt,
    endpoint,
    grantedAt: granted.timePackGrantedAt,
  };
}
