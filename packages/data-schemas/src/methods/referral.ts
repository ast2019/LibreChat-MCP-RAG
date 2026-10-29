import crypto from 'node:crypto';
import type { Model, Types } from 'mongoose';
import type { IUser } from '~/types';

/** Unambiguous characters only (no 0/O, 1/I/L), so a code read aloud or retyped still works. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function normalizeReferralCode(code: unknown): string | null {
  if (typeof code !== 'string') {
    return null;
  }
  const normalized = code.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export interface ReferralStats {
  /** Accounts that signed up with this user's code */
  invited: number;
  /** Of those, the ones whose reward was paid */
  rewarded: number;
}

export type AttachReferrerResult =
  | { ok: true; referrerId: string }
  | {
      ok: false;
      reason: 'invalid_code' | 'self' | 'already_referred' | 'too_old' | 'not_found';
    };

export interface ReferralMethods {
  /** The user's invite code, creating one on first use. */
  getOrCreateReferralCode: (userId: string) => Promise<string>;
  /**
   * Records who invited `inviteeId`: once, for an account created within `maxAgeMs`, and never
   * the account itself.
   */
  attachReferrer: (params: {
    inviteeId: string;
    code: string;
    maxAgeMs: number;
    now?: Date;
  }) => Promise<AttachReferrerResult>;
  /**
   * Marks the invite reward of `inviteeId` as paid and returns its referrer, or null when the
   * invitee has no referrer or was rewarded already. Atomic, so a reward is paid at most once
   * however many requests race for it.
   */
  claimReferralReward: (inviteeId: string, now?: Date) => Promise<string | null>;
  /** Undoes {@link claimReferralReward} when paying it failed, so a later attempt can retry. */
  releaseReferralReward: (inviteeId: string) => Promise<void>;
  getReferralStats: (referrerId: string) => Promise<ReferralStats>;
  /** Credits a user received under one ledger context (e.g. `referral`). */
  sumCreditsByContext: (userId: string, context: string) => Promise<number>;
}

export function createReferralMethods(mongoose: typeof import('mongoose')): ReferralMethods {
  const users = () => mongoose.models.User as Model<IUser>;

  async function getOrCreateReferralCode(userId: string): Promise<string> {
    const existing = await users().findById(userId, 'referralCode').lean();
    if (existing?.referralCode) {
      return existing.referralCode;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        const updated = await users()
          .findOneAndUpdate(
            { _id: userId, referralCode: { $exists: false } },
            { $set: { referralCode: code } },
            { new: true, projection: 'referralCode' },
          )
          .lean();
        if (updated?.referralCode) {
          return updated.referralCode;
        }
        /** Another request set one first */
        const raced = await users().findById(userId, 'referralCode').lean();
        if (raced?.referralCode) {
          return raced.referralCode;
        }
        throw new Error('User not found');
      } catch (error) {
        /** A duplicate code: draw again */
        if ((error as { code?: number }).code === 11000) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Could not allocate a referral code');
  }

  async function attachReferrer({
    inviteeId,
    code,
    maxAgeMs,
    now = new Date(),
  }: {
    inviteeId: string;
    code: string;
    maxAgeMs: number;
    now?: Date;
  }): Promise<AttachReferrerResult> {
    const normalized = normalizeReferralCode(code);
    if (!normalized) {
      return { ok: false, reason: 'invalid_code' };
    }
    const referrer = await users().findOne({ referralCode: normalized }, '_id').lean();
    if (!referrer) {
      return { ok: false, reason: 'invalid_code' };
    }
    const referrerId = String(referrer._id);
    if (referrerId === String(inviteeId)) {
      return { ok: false, reason: 'self' };
    }
    const invitee = await users()
      .findById(inviteeId, 'createdAt referredBy')
      .lean<{ createdAt?: Date; referredBy?: Types.ObjectId }>();
    if (!invitee) {
      return { ok: false, reason: 'not_found' };
    }
    if (invitee.referredBy != null) {
      return { ok: false, reason: 'already_referred' };
    }
    const createdAt = invitee.createdAt ? new Date(invitee.createdAt).getTime() : 0;
    if (!createdAt || now.getTime() - createdAt > maxAgeMs) {
      return { ok: false, reason: 'too_old' };
    }
    const result = await users().updateOne(
      { _id: inviteeId, referredBy: { $exists: false } },
      { $set: { referredBy: referrer._id } },
    );
    if (result.modifiedCount === 0) {
      return { ok: false, reason: 'already_referred' };
    }
    return { ok: true, referrerId };
  }

  async function claimReferralReward(inviteeId: string, now = new Date()): Promise<string | null> {
    const claimed = await users()
      .findOneAndUpdate(
        {
          _id: inviteeId,
          referredBy: { $exists: true },
          referralRewardedAt: { $exists: false },
        },
        { $set: { referralRewardedAt: now } },
        { new: true, projection: 'referredBy' },
      )
      .lean();
    return claimed?.referredBy != null ? String(claimed.referredBy) : null;
  }

  async function releaseReferralReward(inviteeId: string): Promise<void> {
    await users().updateOne({ _id: inviteeId }, { $unset: { referralRewardedAt: 1 } });
  }

  async function getReferralStats(referrerId: string): Promise<ReferralStats> {
    const id = new mongoose.Types.ObjectId(referrerId);
    const [invited, rewarded] = await Promise.all([
      users().countDocuments({ referredBy: id }),
      users().countDocuments({ referredBy: id, referralRewardedAt: { $exists: true } }),
    ]);
    return { invited, rewarded };
  }

  async function sumCreditsByContext(userId: string, context: string): Promise<number> {
    const Transaction = mongoose.models.Transaction;
    const [row] = await Transaction.aggregate<{ total: number }>([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          tokenType: 'credits',
          context,
          rawAmount: { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$rawAmount' } } },
    ]);
    return row?.total ?? 0;
  }

  return {
    sumCreditsByContext,
    getOrCreateReferralCode,
    attachReferrer,
    claimReferralReward,
    releaseReferralReward,
    getReferralStats,
  };
}
