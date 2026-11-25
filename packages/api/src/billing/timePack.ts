import {
  isTimePack,
  TIME_METER_CONTEXT,
  getActiveTimePackEntitlement,
} from 'librechat-data-provider';
import type { TBalancePack, TimePackFields as EntitlementFields } from 'librechat-data-provider';

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

export type SetUserTimePackOptions = { allowSameRevision?: boolean };

export interface GrantTimePackDeps {
  /**
   * Records the grant on the balance record in one atomic write (data-schemas
   * `extendBalanceTimePack`): a re-grant on the same endpoint before expiry adds `durationDays`
   * to the stored expiry, so concurrent grants each keep their days.
   */
  extendTimePack: (user: string, grant: TimePackExtension) => Promise<GrantedTimePackFields>;
  /**
   * Copies the granted fields onto the user document (data-schemas `setUserTimePack`), applied
   * only over an older revision (or the same revision when repairing), and invalidates the
   * cached auth user.
   */
  setUserTimePack?: (
    user: string,
    fields: GrantedTimePackFields,
    options?: SetUserTimePackOptions,
  ) => Promise<unknown>;
  now?: () => Date;
}

export interface GrantTimePackResult {
  pack: { id: string; label: string };
  expiresAt: Date;
  endpoint: string;
  grantedAt: Date;
}

/** Balance fields the sync path needs; revision orders the copy onto the user. */
export type TimePackBalanceRecord = {
  timePackId?: string | null;
  timePackLabel?: string | null;
  timePackEndpoint?: string | null;
  timePackExpiresAt?: Date | string | null;
  timePackGrantedAt?: Date | string | null;
  timePackRevision?: number | null;
};

export interface SyncUserTimePackDeps {
  findBalanceByUser: (userId: string) => Promise<TimePackBalanceRecord | null>;
  setUserTimePack: (
    userId: string,
    fields: GrantedTimePackFields,
    options?: SetUserTimePackOptions,
  ) => Promise<unknown>;
  now?: () => Date;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Builds grant fields from a balance record when it holds an active time pack with a revision.
 * Returns null when the balance has no usable entitlement to copy.
 */
export function grantedTimePackFromBalance(
  balance: TimePackBalanceRecord | null | undefined,
  now: Date = new Date(),
): GrantedTimePackFields | null {
  if (balance == null) {
    return null;
  }
  const revision = balance.timePackRevision;
  if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 1) {
    return null;
  }
  const timePackId = typeof balance.timePackId === 'string' ? balance.timePackId.trim() : '';
  const timePackEndpoint =
    typeof balance.timePackEndpoint === 'string' ? balance.timePackEndpoint.trim() : '';
  const timePackExpiresAt = asDate(balance.timePackExpiresAt);
  const timePackGrantedAt = asDate(balance.timePackGrantedAt) ?? now;
  const timePackLabel =
    typeof balance.timePackLabel === 'string' && balance.timePackLabel.trim() !== ''
      ? balance.timePackLabel.trim()
      : timePackId;
  if (
    !timePackId ||
    !timePackEndpoint ||
    timePackExpiresAt == null ||
    timePackExpiresAt.getTime() <= now.getTime()
  ) {
    return null;
  }
  return {
    timePackId,
    timePackLabel,
    timePackEndpoint,
    timePackExpiresAt,
    timePackGrantedAt,
    timePackRevision: revision,
  };
}

/** Writes the granted fields onto a mutable user-like object used for routing and config. */
export function applyGrantedTimePackToUser<T extends EntitlementFields>(
  user: T,
  granted: GrantedTimePackFields,
): T {
  user.timePackId = granted.timePackId;
  user.timePackLabel = granted.timePackLabel;
  user.timePackEndpoint = granted.timePackEndpoint;
  user.timePackExpiresAt = granted.timePackExpiresAt;
  user.timePackGrantedAt = granted.timePackGrantedAt;
  return user;
}

/**
 * When the loaded user has no active Claude time entitlement but the balance record does,
 * copies the balance fields onto the user (same-revision repair allowed) and returns them.
 * Model-spec filtering and seat admission both read the user document; the balance badge
 * alone is not enough, so a grant that updated only the balance left users on OpenRouter Claude.
 */
export async function syncUserTimePackFromBalance(
  deps: SyncUserTimePackDeps,
  userId: string,
  user?: EntitlementFields | null,
): Promise<GrantedTimePackFields | null> {
  const now = (deps.now ?? (() => new Date()))();
  if (getActiveTimePackEntitlement(user ?? undefined, now) != null) {
    return null;
  }
  const balance = await deps.findBalanceByUser(userId);
  const granted = grantedTimePackFromBalance(balance, now);
  if (granted == null) {
    return null;
  }
  await deps.setUserTimePack(userId, granted, { allowSameRevision: true });
  return granted;
}

/**
 * Records a Claude time entitlement without touching token credits or the credit pack id. A
 * re-grant before expiry on the same endpoint adds `durationDays` to the current expiry.
 * After the balance write, the fields are copied onto the user; if the first copy loses a
 * revision race, a same-revision repair is attempted so the user document is not left behind.
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
  if (deps.setUserTimePack != null) {
    const applied = await deps.setUserTimePack(userId, granted);
    if (applied === false) {
      await deps.setUserTimePack(userId, granted, { allowSameRevision: true });
    }
  }
  return {
    pack: { id: pack.id, label: pack.label },
    expiresAt: granted.timePackExpiresAt,
    endpoint,
    grantedAt: granted.timePackGrantedAt,
  };
}
