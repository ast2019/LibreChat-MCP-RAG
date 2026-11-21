import { isTimePack, timePackExpiresAt, TIME_METER_CONTEXT } from 'librechat-data-provider';
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

export interface GrantTimePackDeps {
  /** Same balance writer as credit grants; only time fields are set for this path. */
  upsertBalanceFields: GrantBalanceUpsert;
  setUserTimePack?: (user: string, fields: TimePackFields) => Promise<unknown>;
  now?: () => Date;
}

type GrantBalanceUpsert = (
  user: string,
  fields: Partial<TimePackFields> & {
    packId?: string;
    packLabel?: string;
    packAllotment?: number;
    packGrantedAt?: Date;
  },
) => Promise<unknown>;

export interface GrantTimePackResult {
  pack: { id: string; label: string };
  expiresAt: Date;
  endpoint: string;
  grantedAt: Date;
}

/**
 * Records a Claude time entitlement without touching token credits or the credit pack id.
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
  const grantedAt = (deps.now ?? (() => new Date()))();
  const expiresAt = timePackExpiresAt(grantedAt, durationDays);
  const fields: TimePackFields = {
    timePackId: pack.id,
    timePackLabel: pack.label,
    timePackExpiresAt: expiresAt,
    timePackGrantedAt: grantedAt,
    timePackEndpoint: endpoint,
  };
  await deps.upsertBalanceFields(userId, fields);
  await deps.setUserTimePack?.(userId, fields);
  return {
    pack: { id: pack.id, label: pack.label },
    expiresAt,
    endpoint,
    grantedAt,
  };
}
