import { z } from 'zod';

/**
 * Invite rewards. A user shares a link with their code (`/register?ref=CODE`); when someone
 * signs up through it, both receive credits once the new account has a verified mobile number
 * (unique per account, so one person cannot farm rewards with throwaway emails).
 */
export const referralConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Credits the inviter receives per rewarded invite (1,000,000 credits = $1 at list price). */
  referrerCredits: z.number().int().min(0).max(100_000_000).default(500_000),
  /** Extra credits the invited account receives on top of the start balance. */
  inviteeCredits: z.number().int().min(0).max(100_000_000).default(200_000),
  /** Rewarded invites per inviter; later sign-ups still count but pay nothing. */
  maxRewardsPerReferrer: z.number().int().min(0).max(10_000).default(20),
  /** How long after signing up an account can still be linked to an invite code. */
  claimWindowDays: z.number().int().min(1).max(90).default(7),
  /** Pay only once the invited account has a verified mobile number. */
  requirePhone: z.boolean().default(true),
});

export type TReferralConfig = z.infer<typeof referralConfigSchema>;

/** What `/api/config` tells the client: just whether to show the invite entry points. */
export interface TReferralStartupConfig {
  enabled: true;
  referrerCredits: number;
  inviteeCredits: number;
}

/** `GET /api/referral` */
export interface TReferralInfo {
  code: string;
  /** Sign-up link carrying the code, on this deployment's client origin */
  link: string;
  referrerCredits: number;
  inviteeCredits: number;
  maxRewards: number;
  invited: number;
  rewarded: number;
  /** Credits earned so far from invites */
  earnedCredits: number;
  requirePhone: boolean;
}

export type TReferralClaimStatus =
  /** Both sides were paid */
  | 'rewarded'
  /** Linked; pays once this account verifies a mobile number */
  | 'pending_phone'
  /** Linked; the inviter reached the cap, so nothing is paid */
  | 'capped'
  | 'invalid_code'
  | 'self'
  | 'already_referred'
  | 'too_old'
  | 'disabled';

/** `POST /api/referral/claim` */
export interface TReferralClaimResponse {
  status: TReferralClaimStatus;
  /** Credits this account received, when `rewarded` */
  credits?: number;
}

/** Query parameter and storage key the sign-up link's code travels in. */
export const REFERRAL_QUERY_PARAM = 'ref';
export const REFERRAL_STORAGE_KEY = 'referralCode';
