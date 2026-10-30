import { referralConfigSchema } from 'librechat-data-provider';
import type {
  TReferralConfig,
  TReferralInfo,
  TReferralClaimResponse,
  TReferralStartupConfig,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { readConfigSection } from '~/app/config';

/** Ledger contexts of invite rewards, so they stay separable from purchases and grants: what
 *  an inviter earns, and the welcome credits of the account they invited. */
export const REFERRAL_GRANT_CONTEXT = 'referral';
export const REFERRAL_WELCOME_CONTEXT = 'referral_welcome';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `referral` from `librechat.yaml` with the admin page's amounts on top. It is re-parsed, so an
 *  invalid block counts as off. Read per request, so a change applies from then on. */
export function resolveReferralSettings(appConfig?: AppConfig | null): TReferralConfig {
  const raw = readConfigSection(appConfig, 'referral');
  const parsed = referralConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : referralConfigSchema.parse({});
}

/** The `/api/config` field; undefined while rewards are off. */
export function getReferralStartupConfig(
  appConfig?: AppConfig | null,
): TReferralStartupConfig | undefined {
  const settings = resolveReferralSettings(appConfig);
  if (!settings.enabled) {
    return undefined;
  }
  return {
    enabled: true,
    referrerCredits: settings.referrerCredits,
    inviteeCredits: settings.inviteeCredits,
  };
}

export interface ReferralUser {
  id: string;
  phoneVerified?: boolean;
}

export interface ReferralDeps {
  getOrCreateReferralCode: (userId: string) => Promise<string>;
  attachReferrer: (params: {
    inviteeId: string;
    code: string;
    maxAgeMs: number;
  }) => Promise<
    | { ok: true; referrerId: string }
    | { ok: false; reason: 'invalid_code' | 'self' | 'already_referred' | 'too_old' | 'not_found' }
  >;
  claimReferralReward: (inviteeId: string) => Promise<string | null>;
  releaseReferralReward: (inviteeId: string) => Promise<void>;
  getReferralStats: (referrerId: string) => Promise<{ invited: number; rewarded: number }>;
  findUser: (userId: string) => Promise<ReferralUser | null>;
  /** Writes one credits transaction to the ledger and the balance. */
  createTransaction: (tx: {
    user: string;
    tokenType: 'credits';
    context: string;
    rawAmount: number;
    balance: { enabled: boolean };
  }) => Promise<{ balance?: number } | undefined>;
  /** Credits a user has earned from invites, from the ledger */
  getEarnedReferralCredits?: (userId: string) => Promise<number>;
  logError?: (message: string, error: unknown) => void;
}

async function grant(
  deps: ReferralDeps,
  userId: string,
  credits: number,
  context: string,
): Promise<void> {
  if (credits <= 0) {
    return;
  }
  const result = await deps.createTransaction({
    user: userId,
    tokenType: 'credits',
    context,
    rawAmount: credits,
    balance: { enabled: true },
  });
  if (result == null || typeof result.balance !== 'number') {
    throw new Error('Referral grant was not recorded; check that transactions are enabled');
  }
}

/**
 * Pays the invite reward of `inviteeId` when it is due: the account has a referrer, has not been
 * paid, and (when required) has a verified mobile. The invitee is paid in any case; the inviter
 * only within `maxRewardsPerReferrer`. Safe to call again and again; it pays once.
 */
export async function settleReferral(
  deps: ReferralDeps,
  settings: TReferralConfig,
  inviteeId: string,
): Promise<TReferralClaimResponse> {
  if (!settings.enabled) {
    return { status: 'disabled' };
  }
  const invitee = await deps.findUser(inviteeId);
  if (!invitee) {
    return { status: 'invalid_code' };
  }
  if (settings.requirePhone && invitee.phoneVerified !== true) {
    return { status: 'pending_phone' };
  }
  const referrerId = await deps.claimReferralReward(inviteeId);
  if (referrerId == null) {
    return { status: 'already_referred' };
  }
  try {
    const { rewarded } = await deps.getReferralStats(referrerId);
    /** `rewarded` already counts this invite */
    const referrerPaid = rewarded <= settings.maxRewardsPerReferrer;
    await grant(deps, inviteeId, settings.inviteeCredits, REFERRAL_WELCOME_CONTEXT);
    if (referrerPaid) {
      await grant(deps, referrerId, settings.referrerCredits, REFERRAL_GRANT_CONTEXT);
    }
    return referrerPaid
      ? { status: 'rewarded', credits: settings.inviteeCredits }
      : { status: 'capped', credits: settings.inviteeCredits };
  } catch (error) {
    deps.logError?.('[referral] Paying an invite reward failed', error);
    await deps.releaseReferralReward(inviteeId);
    throw error;
  }
}

/** Links the signed-in (new) account to the inviter whose code it brings, then settles. */
export async function claimReferral(
  deps: ReferralDeps,
  settings: TReferralConfig,
  { userId, code }: { userId: string; code: string },
): Promise<TReferralClaimResponse> {
  if (!settings.enabled) {
    return { status: 'disabled' };
  }
  const attached = await deps.attachReferrer({
    inviteeId: userId,
    code,
    maxAgeMs: settings.claimWindowDays * DAY_MS,
  });
  if (!attached.ok && attached.reason !== 'already_referred') {
    return { status: attached.reason === 'not_found' ? 'invalid_code' : attached.reason };
  }
  /** Linked now or earlier: either way this is the moment a pending reward may become due. */
  return settleReferral(deps, settings, userId);
}

export async function getReferralInfo(
  deps: ReferralDeps,
  settings: TReferralConfig,
  { userId, clientOrigin }: { userId: string; clientOrigin: string },
): Promise<TReferralInfo> {
  const [code, stats, earned] = await Promise.all([
    deps.getOrCreateReferralCode(userId),
    deps.getReferralStats(userId),
    deps.getEarnedReferralCredits?.(userId) ?? Promise.resolve(0),
  ]);
  const link = new URL('/register', clientOrigin);
  link.searchParams.set('ref', code);
  return {
    code,
    link: link.toString(),
    referrerCredits: settings.referrerCredits,
    inviteeCredits: settings.inviteeCredits,
    maxRewards: settings.maxRewardsPerReferrer,
    invited: stats.invited,
    rewarded: stats.rewarded,
    earnedCredits: earned,
    requirePhone: settings.requirePhone,
  };
}
