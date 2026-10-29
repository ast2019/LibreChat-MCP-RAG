import { normalizeIranianMobile } from 'librechat-data-provider';
import type { TUserModelAccess } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { ITransaction } from '~/schema/transaction';
import type { IBalance } from '~/types/balance';
import type { IUser } from '~/types';
import { buildUserSearchFilter } from '~/utils/search';

/** A user row for the billing admin page; plain data, no storage types. */
export interface BillingUserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  /** E.164 mobile number; empty when the account has none */
  phone: string;
  role: string;
  createdAt?: string;
  /** The user's own local/private model override; empty when the user follows the role */
  modelAccess: TUserModelAccess;
  /** The user's own programming API override; absent when the user follows the role */
  apiAccess?: boolean;
  balance: {
    tokenCredits: number;
    packId?: string;
    packLabel?: string;
    packAllotment?: number;
    packGrantedAt?: string;
  } | null;
}

export interface BillingModelSpend {
  model: string;
  credits: number;
}

export interface BillingSummary {
  totalUsers: number;
  /** Users with any chat spend in the window */
  activeUsers: number;
  /** Credits added to balances (packs, manual grants, invite rewards), all time and in the window */
  creditsGranted: number;
  creditsGrantedInWindow: number;
  packGrantsInWindow: number;
  /** Credits users spent on models and OCR in the window (positive number) */
  creditsSpentInWindow: number;
  /** Part of `creditsSpentInWindow` with no provider cost (on-server OCR pages) */
  creditsSpentLocalInWindow: number;
  /** Credits currently held across all balances */
  creditsOutstanding: number;
  topModels: BillingModelSpend[];
}

/** One user's spend in a window, split by what it paid for and by model. */
export interface BillingUserUsage {
  /** Positive credits spent in the window */
  totalCredits: number;
  /** Ledger context (`message`, `memory`, `title`, `ocr`…), largest first */
  byContext: Array<{ context: string; credits: number; count: number }>;
  /** Model, largest first (at most 10) */
  byModel: Array<{ model: string; credits: number }>;
}

const MAX_PAGE_SIZE = 100;
/** Credits added to balances: packs, manual grants and invite rewards (both sides). */
const GRANT_CONTEXTS = ['pack', 'admin', 'referral', 'referral_welcome'];
const SPEND_TOKEN_TYPES = ['prompt', 'completion'];
/** `credits` transactions that are usage with no provider cost: on-server OCR pages. */
const LOCAL_SPEND_CONTEXTS = ['ocr_local'];
/** Every `credits` transaction that is usage, not a grant: on-server OCR pages and server
 *  speech (transcription and read-aloud are priced in credits from the provider's cost). */
const CREDIT_SPEND_CONTEXTS = [...LOCAL_SPEND_CONTEXTS, 'stt', 'tts'];
/** Every spend transaction: token usage (chat, vision OCR) and credit-priced usage. */
const SPEND_MATCH = {
  $or: [
    { tokenType: { $in: SPEND_TOKEN_TYPES } },
    { tokenType: 'credits', context: { $in: CREDIT_SPEND_CONTEXTS } },
  ],
};

export function createBillingMethods(mongoose: typeof import('mongoose')): {
  listUsersWithBalances: (params: {
    search?: string;
    limit?: number;
    offset?: number;
  }) => Promise<{ users: BillingUserRow[]; total: number }>;
  getBillingSummary: (params: { since: Date; topModels?: number }) => Promise<BillingSummary>;
  getUserUsageByContext: (params: { userId: string; since: Date }) => Promise<BillingUserUsage>;
} {
  const users = () => mongoose.models.User as Model<IUser>;
  const balances = () => mongoose.models.Balance as Model<IBalance>;
  const transactions = () => mongoose.models.Transaction as Model<ITransaction>;

  async function listUsersWithBalances({
    search,
    limit = 25,
    offset = 0,
  }: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ users: BillingUserRow[]; total: number }> {
    const trimmed = typeof search === 'string' ? search.trim().slice(0, 200) : '';
    const tokenFilter = trimmed ? buildUserSearchFilter(trimmed, { legacyPrefix: true }) : null;
    /** A search that reads as a mobile number also matches the stored E.164 phone exactly. */
    const phone = trimmed ? normalizeIranianMobile(trimmed) : null;
    let filter: Record<string, unknown> = tokenFilter ?? {};
    if (phone) {
      filter = tokenFilter ? { $or: [tokenFilter, { phone }] } : { phone };
    }
    const pageSize = Math.min(Math.max(Math.trunc(limit) || 25, 1), MAX_PAGE_SIZE);
    const skip = Math.max(Math.trunc(offset) || 0, 0);

    const [docs, total] = await Promise.all([
      users()
        .find(filter, '_id name username email phone role createdAt modelAccess apiAccess')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      users().countDocuments(filter),
    ]);
    const ids = docs.map((doc) => doc._id);
    const balanceDocs = ids.length
      ? await balances()
          .find(
            { user: { $in: ids } },
            'user tokenCredits packId packLabel packAllotment packGrantedAt',
          )
          .lean()
      : [];
    const byUser = new Map(balanceDocs.map((doc) => [String(doc.user), doc]));

    return {
      total,
      users: docs.map((doc) => {
        const balance = byUser.get(String(doc._id));
        return {
          id: String(doc._id),
          name: doc.name ?? '',
          username: doc.username ?? '',
          email: doc.email ?? '',
          phone: doc.phone ?? '',
          role: doc.role ?? 'USER',
          createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
          modelAccess: {
            ...(typeof doc.modelAccess?.local === 'boolean' && { local: doc.modelAccess.local }),
            ...(typeof doc.modelAccess?.private === 'boolean' && {
              private: doc.modelAccess.private,
            }),
          },
          ...(typeof doc.apiAccess === 'boolean' && { apiAccess: doc.apiAccess }),
          balance: balance
            ? {
                tokenCredits: balance.tokenCredits ?? 0,
                packId: balance.packId,
                packLabel: balance.packLabel,
                packAllotment: balance.packAllotment,
                packGrantedAt: balance.packGrantedAt
                  ? new Date(balance.packGrantedAt).toISOString()
                  : undefined,
              }
            : null,
        };
      }),
    };
  }

  async function getBillingSummary({
    since,
    topModels = 10,
  }: {
    since: Date;
    topModels?: number;
  }): Promise<BillingSummary> {
    const [totalUsers, grants, spend, outstanding, models] = await Promise.all([
      users().countDocuments({}),
      transactions().aggregate<{ _id: null; all: number; inWindow: number; countInWindow: number }>(
        [
          {
            $match: {
              tokenType: 'credits',
              context: { $in: GRANT_CONTEXTS },
              rawAmount: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              all: { $sum: '$tokenValue' },
              inWindow: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, '$tokenValue', 0] } },
              countInWindow: {
                $sum: {
                  $cond: [
                    { $and: [{ $gte: ['$createdAt', since] }, { $eq: ['$context', 'pack'] }] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
      ),
      transactions().aggregate<{ _id: null; credits: number; local: number; users: string[] }>([
        { $match: { ...SPEND_MATCH, createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            credits: { $sum: '$tokenValue' },
            local: {
              $sum: {
                $cond: [{ $in: ['$context', LOCAL_SPEND_CONTEXTS] }, '$tokenValue', 0],
              },
            },
            users: { $addToSet: '$user' },
          },
        },
      ]),
      balances().aggregate<{ _id: null; credits: number }>([
        { $group: { _id: null, credits: { $sum: '$tokenCredits' } } },
      ]),
      transactions().aggregate<{ _id: string; credits: number }>([
        { $match: { ...SPEND_MATCH, createdAt: { $gte: since } } },
        { $group: { _id: '$model', credits: { $sum: '$tokenValue' } } },
        { $sort: { credits: 1 } },
        { $limit: Math.min(Math.max(topModels, 1), 50) },
      ]),
    ]);

    return {
      totalUsers,
      activeUsers: spend[0]?.users.length ?? 0,
      creditsGranted: grants[0]?.all ?? 0,
      creditsGrantedInWindow: grants[0]?.inWindow ?? 0,
      packGrantsInWindow: grants[0]?.countInWindow ?? 0,
      /** Spend is stored as negative token values */
      creditsSpentInWindow: Math.abs(spend[0]?.credits ?? 0),
      creditsSpentLocalInWindow: Math.abs(spend[0]?.local ?? 0),
      creditsOutstanding: outstanding[0]?.credits ?? 0,
      topModels: models.map((row) => ({
        model: row._id ?? 'unknown',
        credits: Math.abs(row.credits ?? 0),
      })),
    };
  }

  async function getUserUsageByContext({
    userId,
    since,
  }: {
    userId: string;
    since: Date;
  }): Promise<BillingUserUsage> {
    const match = {
      ...SPEND_MATCH,
      user: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: since },
    };
    const [contexts, models] = await Promise.all([
      transactions().aggregate<{ _id: string | null; credits: number; count: number }>([
        { $match: match },
        {
          $group: {
            _id: '$context',
            credits: { $sum: '$tokenValue' },
            /** A model call writes a prompt and a completion row; count calls, not rows */
            count: { $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, 0, 1] } },
          },
        },
        { $sort: { credits: 1 } },
      ]),
      transactions().aggregate<{ _id: string | null; credits: number }>([
        { $match: match },
        { $group: { _id: '$model', credits: { $sum: '$tokenValue' } } },
        { $sort: { credits: 1 } },
        { $limit: 10 },
      ]),
    ]);
    const byContext = contexts.map((row) => ({
      context: row._id ?? 'other',
      credits: Math.abs(row.credits ?? 0),
      count: row.count ?? 0,
    }));
    return {
      totalCredits: byContext.reduce((sum, row) => sum + row.credits, 0),
      byContext,
      byModel: models.map((row) => ({
        model: row._id ?? 'unknown',
        credits: Math.abs(row.credits ?? 0),
      })),
    };
  }

  return { listUsersWithBalances, getBillingSummary, getUserUsageByContext };
}

export type BillingMethods = ReturnType<typeof createBillingMethods>;
