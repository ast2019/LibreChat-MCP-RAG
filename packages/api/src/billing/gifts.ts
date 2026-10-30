import { logger } from '@librechat/data-schemas';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { resolveReferralSettings } from '~/referral/service';
import { getBalanceConfig } from '~/app/config';

type GiftRequest = Request & { user?: IUser & { id?: string } };

/** The gifts new accounts get, as the admin page edits them; amounts are credits ($1 = 1,000,000). */
export interface GiftSettings {
  /** Credited to every new account on sign-up */
  startBalance: number;
  referral: {
    enabled: boolean;
    /** Paid to the inviter for each rewarded invite */
    referrerCredits: number;
    /** Paid to the invited account, on top of the sign-up gift */
    inviteeCredits: number;
    maxRewardsPerReferrer: number;
  };
  /** When the admin page last changed them; absent while the file's values apply */
  changedAt?: string;
}

const MAX_CREDITS = 100_000_000;
const MAX_REWARDS = 10_000;

export interface AdminGiftDeps {
  /** The config new sign-ups resolve under (`__base__` overrides applied) */
  getAppConfig: (req: GiftRequest) => Promise<AppConfig>;
  /** When the base override document was last written, if one exists */
  getBaseChangedAt: () => Promise<Date | null>;
  /** Writes dotted fields on the base override document */
  patchBaseFields: (fields: Record<string, unknown>) => Promise<void>;
  /** Drops cached configs so the next request reads the new values */
  invalidate: (tenantId?: string) => Promise<void> | void;
}

export function readGiftSettings(appConfig: AppConfig | null | undefined): GiftSettings {
  const balance = getBalanceConfig(appConfig ?? undefined);
  const referral = resolveReferralSettings(appConfig);
  return {
    startBalance: balance?.enabled === true ? (balance.startBalance ?? 0) : 0,
    referral: {
      enabled: referral.enabled,
      referrerCredits: referral.referrerCredits,
      inviteeCredits: referral.inviteeCredits,
      maxRewardsPerReferrer: referral.maxRewardsPerReferrer,
    },
  };
}

const isCredits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CREDITS;

/** The fields an admin sent, validated; only the ones present are changed. */
export function parseGiftUpdate(
  body: unknown,
): { ok: true; fields: Record<string, unknown> } | { ok: false; code: string } {
  const source = (body ?? {}) as Record<string, unknown>;
  const referral = (source.referral ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (source.startBalance !== undefined) {
    if (!isCredits(source.startBalance)) {
      return { ok: false, code: 'invalid_start_balance' };
    }
    fields['balance.startBalance'] = source.startBalance;
  }
  for (const key of ['referrerCredits', 'inviteeCredits'] as const) {
    if (referral[key] !== undefined) {
      if (!isCredits(referral[key])) {
        return { ok: false, code: `invalid_${key}` };
      }
      fields[`referral.${key}`] = referral[key];
    }
  }
  if (referral.maxRewardsPerReferrer !== undefined) {
    const value = referral.maxRewardsPerReferrer;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_REWARDS) {
      return { ok: false, code: 'invalid_maxRewardsPerReferrer' };
    }
    fields['referral.maxRewardsPerReferrer'] = value;
  }
  if (referral.enabled !== undefined) {
    if (typeof referral.enabled !== 'boolean') {
      return { ok: false, code: 'invalid_enabled' };
    }
    fields['referral.enabled'] = referral.enabled;
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, code: 'nothing_to_change' };
  }
  return { ok: true, fields };
}

/**
 * `GET|PUT /api/admin/balance/gifts`: the sign-up gift and invite rewards. A change is stored as
 * a deployment-wide override and applies to sign-ups and invites from that moment; accounts and
 * rewards already paid keep what they got.
 */
export function createAdminGiftHandlers(deps: AdminGiftDeps): {
  getGifts: (req: GiftRequest, res: Response) => Promise<Response>;
  updateGifts: (req: GiftRequest, res: Response) => Promise<Response>;
} {
  async function current(req: GiftRequest): Promise<GiftSettings> {
    const [appConfig, changedAt] = await Promise.all([
      deps.getAppConfig(req),
      deps.getBaseChangedAt(),
    ]);
    return {
      ...readGiftSettings(appConfig),
      ...(changedAt ? { changedAt: changedAt.toISOString() } : {}),
    };
  }

  async function getGifts(req: GiftRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await current(req));
    } catch (error) {
      logger.error('[adminGifts] read failed', error);
      return res.status(500).json({ error: { code: 'gifts_read_failed' } });
    }
  }

  async function updateGifts(req: GiftRequest, res: Response): Promise<Response> {
    const parsed = parseGiftUpdate(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: { code: parsed.code } });
    }
    try {
      await deps.patchBaseFields(parsed.fields);
      await deps.invalidate(req.user?.tenantId);
      logger.info(`[adminGifts] ${req.user?.id} changed ${Object.keys(parsed.fields).join(', ')}`);
      return res.status(200).json(await current(req));
    } catch (error) {
      logger.error('[adminGifts] update failed', error);
      return res.status(500).json({ error: { code: 'gifts_update_failed' } });
    }
  }

  return { getGifts, updateGifts };
}
