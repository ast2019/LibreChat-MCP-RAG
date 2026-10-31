import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  BillingSummary,
  BillingUserRow,
  BillingUserUsage,
} from '@librechat/data-schemas';
import type {
  TBalancePack,
  TBalanceConfig,
  TAdminBillingUsersParams,
} from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { AccessRules, RoleAccess } from '../admin/effectiveAccess';
import type { GrantBalanceDeps } from './packs';
import { computeEffectiveAccess } from '../admin/effectiveAccess';
import { MAX_BULK_USERS, readBulkUserIds } from '../admin/access';
import { grantBalance, resolveBalanceGrant } from './packs';

type BillingRequest = Request & { user?: IUser };

/** A user as the billing handlers need it; plain data, no storage types. */
export interface BillingUser {
  id: string;
  email?: string;
}

/** A user's balance as the admin lookup reports it. */
export interface BillingBalance {
  tokenCredits: number;
  packId?: string;
  packLabel?: string;
  packAllotment?: number;
  packGrantedAt?: Date | string;
}

export interface AdminBalanceDeps extends GrantBalanceDeps {
  /** Balance settings that apply to the requesting admin's deployment/tenant. */
  getBalanceConfig: (req: BillingRequest) => Promise<Partial<TBalanceConfig> | null>;
  findUserByEmail: (email: string) => Promise<BillingUser | null>;
  findUserById: (id: string) => Promise<BillingUser | null>;
  findBalanceByUser: (userId: string) => Promise<BillingBalance | null>;
  listUsersWithBalances: (
    params: TAdminBillingUsersParams,
  ) => Promise<{ users: BillingUserRow[]; total: number }>;
  getBillingSummary: (params: { since: Date }) => Promise<BillingSummary>;
  /** One user's spend in a window, by ledger context and by model. */
  getUserUsageByContext?: (params: { userId: string; since: Date }) => Promise<BillingUserUsage>;
  /** Markup applied to provider prices; the summary divides spend by it to estimate cost. */
  getPriceMultiplier: (req: BillingRequest) => Promise<number | undefined>;
  /**
   * The rules each listed user's effective access is computed against (packs and the media
   * `paidOnly`), and what a role allows. Without both, rows carry no `effective`.
   */
  getAccessRules?: (req: BillingRequest) => Promise<AccessRules>;
  getRoleAccess?: (role: string) => Promise<RoleAccess>;
  now?: () => Date;
}

/** Summary windows the admin page offers, in days. */
export const BILLING_SUMMARY_WINDOWS = [7, 30, 90] as const;

function readInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_EMAIL_LENGTH = 320;

/** Whole percent of the allotment spent, the figure the user's usage bar shows. */
export function getAllotmentUsedPercent(balance: BillingBalance | null): number | null {
  if (balance == null) {
    return null;
  }
  if (!(balance.tokenCredits > 0)) {
    return 100;
  }
  const allotment = balance.packAllotment;
  if (typeof allotment !== 'number' || !(allotment > 0)) {
    return null;
  }
  const spent = (1 - balance.tokenCredits / allotment) * 100;
  return Math.min(Math.max(Math.floor(spent), 0), 99);
}

async function resolveTarget(
  deps: AdminBalanceDeps,
  source: { email?: unknown; userId?: unknown },
): Promise<
  | { ok: true; user: BillingUser }
  | { ok: false; status: number; error: { code: string; message: string } }
> {
  const { email, userId } = source;
  if (typeof userId === 'string' && userId !== '') {
    if (!isValidObjectIdString(userId)) {
      return {
        ok: false,
        status: 400,
        error: { code: 'invalid_user_id', message: 'userId is not a valid id' },
      };
    }
    const user = await deps.findUserById(userId);
    return user
      ? { ok: true, user }
      : { ok: false, status: 404, error: { code: 'user_not_found', message: 'User not found' } };
  }
  if (typeof email === 'string' && email.trim() !== '' && email.length <= MAX_EMAIL_LENGTH) {
    const user = await deps.findUserByEmail(email.trim().toLowerCase());
    return user
      ? { ok: true, user }
      : { ok: false, status: 404, error: { code: 'user_not_found', message: 'User not found' } };
  }
  return {
    ok: false,
    status: 400,
    error: { code: 'grant_target_required', message: 'Send email or userId' },
  };
}

/**
 * Admin HTTP handlers for credit packs. Callers mount them behind authentication and an
 * admin capability check; these handlers trust that and only validate input.
 */
export function createAdminBalanceHandlers(deps: AdminBalanceDeps): {
  listPacks: (req: BillingRequest, res: Response) => Promise<Response>;
  getUserBalance: (req: BillingRequest, res: Response) => Promise<Response>;
  grant: (req: BillingRequest, res: Response) => Promise<Response>;
  grantBulk: (req: BillingRequest, res: Response) => Promise<Response>;
  listUsers: (req: BillingRequest, res: Response) => Promise<Response>;
  summary: (req: BillingRequest, res: Response) => Promise<Response>;
  userUsage: (req: BillingRequest, res: Response) => Promise<Response>;
} {
  async function listPacks(req: BillingRequest, res: Response) {
    try {
      const config = await deps.getBalanceConfig(req);
      const packs: TBalancePack[] = config?.packs ?? [];
      const enabled = config?.enabled === true;
      /** The welcome gift every new account gets, shown on the admin page so it is never a surprise */
      const startBalance =
        enabled && typeof config?.startBalance === 'number' && config.startBalance > 0
          ? config.startBalance
          : 0;
      return res.status(200).json({ enabled, packs, startBalance });
    } catch (error) {
      logger.error('[adminBalance] listPacks error:', error);
      return res.status(500).json({ error: 'Failed to list packs' });
    }
  }

  async function getUserBalance(req: BillingRequest, res: Response) {
    try {
      const target = await resolveTarget(deps, req.query ?? {});
      if (!target.ok) {
        return res.status(target.status).json({ error: target.error });
      }
      const balance = await deps.findBalanceByUser(target.user.id);
      return res.status(200).json({
        user: target.user,
        balance: balance
          ? {
              tokenCredits: balance.tokenCredits,
              packId: balance.packId,
              packLabel: balance.packLabel,
              packAllotment: balance.packAllotment,
              packGrantedAt: balance.packGrantedAt,
              usedPercent: getAllotmentUsedPercent(balance),
            }
          : null,
      });
    } catch (error) {
      logger.error('[adminBalance] getUserBalance error:', error);
      return res.status(500).json({ error: 'Failed to read balance' });
    }
  }

  async function grant(req: BillingRequest, res: Response) {
    try {
      const config = await deps.getBalanceConfig(req);
      if (config?.enabled !== true) {
        return res.status(409).json({
          error: { code: 'balance_disabled', message: 'Enable `balance` in librechat.yaml first' },
        });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const resolution = resolveBalanceGrant(config.packs, body);
      if (!resolution.ok) {
        const status = resolution.error.code === 'pack_not_found' ? 404 : 400;
        return res.status(status).json({ error: resolution.error });
      }
      const target = await resolveTarget(deps, body);
      if (!target.ok) {
        return res.status(target.status).json({ error: target.error });
      }

      const result = await grantBalance(deps, {
        userId: target.user.id,
        credits: resolution.value.credits,
        pack: resolution.value.pack,
      });
      logger.info(
        `[adminBalance] ${req.user?.id ?? 'unknown admin'} granted ${result.credits} credits` +
          `${result.pack ? ` (pack ${result.pack.id})` : ''} to user ${target.user.id}`,
      );
      return res.status(200).json({ user: target.user, ...result });
    } catch (error) {
      logger.error('[adminBalance] grant error:', error);
      return res.status(500).json({ error: 'Failed to grant credits' });
    }
  }

  /**
   * `POST /grant-bulk`: the same pack or credit amount to several users, one ledger grant each.
   * Answers with how many were granted and which ids failed, so a partial run is visible.
   */
  async function grantBulk(req: BillingRequest, res: Response) {
    try {
      const config = await deps.getBalanceConfig(req);
      if (config?.enabled !== true) {
        return res.status(409).json({
          error: { code: 'balance_disabled', message: 'Enable `balance` in librechat.yaml first' },
        });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const userIds = readBulkUserIds(body.userIds);
      if (!userIds) {
        return res.status(400).json({
          error: { code: 'invalid_user_ids', message: `Send 1 to ${MAX_BULK_USERS} user IDs` },
        });
      }
      const resolution = resolveBalanceGrant(config.packs, body);
      if (!resolution.ok) {
        const status = resolution.error.code === 'pack_not_found' ? 404 : 400;
        return res.status(status).json({ error: resolution.error });
      }
      const failed: string[] = [];
      for (const userId of userIds) {
        try {
          const user = await deps.findUserById(userId);
          if (!user) {
            failed.push(userId);
            continue;
          }
          await grantBalance(deps, {
            userId: user.id,
            credits: resolution.value.credits,
            pack: resolution.value.pack,
          });
        } catch (error) {
          logger.error(`[adminBalance] bulk grant to ${userId} failed:`, error);
          failed.push(userId);
        }
      }
      const pack = resolution.value.pack;
      logger.info(
        `[adminBalance] ${req.user?.id ?? 'unknown admin'} granted ${resolution.value.credits} credits` +
          `${pack ? ` (pack ${pack.id})` : ''} to ${userIds.length - failed.length} users`,
      );
      return res.status(200).json({
        granted: userIds.length - failed.length,
        failed,
        credits: resolution.value.credits,
        pack: pack ? { id: pack.id, label: pack.label } : null,
      });
    } catch (error) {
      logger.error('[adminBalance] grantBulk error:', error);
      return res.status(500).json({ error: 'Failed to grant credits' });
    }
  }

  async function listUsers(req: BillingRequest, res: Response) {
    try {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const search = typeof query.search === 'string' ? query.search : undefined;
      const role = query.role === 'USER' || query.role === 'ADMIN' ? query.role : undefined;
      const pack =
        typeof query.pack === 'string' && query.pack.trim() !== ''
          ? query.pack.trim().slice(0, 100)
          : undefined;
      const balance =
        query.balance === 'positive' || query.balance === 'empty' ? query.balance : undefined;
      const access =
        query.access === 'custom' || query.access === 'default' ? query.access : undefined;
      const sort =
        query.sort === 'oldest' || query.sort === 'name' || query.sort === 'newest'
          ? query.sort
          : undefined;
      const limit = Math.min(Math.max(readInt(query.limit, 25), 1), 100);
      const offset = Math.max(readInt(query.offset, 0), 0);
      const { users, total } = await deps.listUsersWithBalances({
        search,
        limit,
        offset,
        ...(role != null && { role }),
        ...(pack != null && { pack }),
        ...(balance != null && { balance }),
        ...(access != null && { access }),
        ...(sort != null && { sort }),
      });
      const rules =
        deps.getAccessRules && deps.getRoleAccess ? await deps.getAccessRules(req) : null;
      /** One role read per role on the page */
      const roleAccess = new Map<string, Promise<RoleAccess>>();
      const accessOf = (role: string) => {
        let pending = roleAccess.get(role);
        if (!pending) {
          pending = (deps.getRoleAccess as (role: string) => Promise<RoleAccess>)(role);
          roleAccess.set(role, pending);
        }
        return pending;
      };
      const rows = await Promise.all(
        users.map(async (user) => ({
          ...user,
          usedPercent: getAllotmentUsedPercent(user.balance),
          ...(rules && {
            effective: computeEffectiveAccess(user, rules, await accessOf(user.role)),
          }),
        })),
      );
      return res.status(200).json({ total, limit, offset, users: rows });
    } catch (error) {
      logger.error('[adminBalance] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function summary(req: BillingRequest, res: Response) {
    try {
      const requested = readInt((req.query as Record<string, unknown> | undefined)?.days, 30);
      const days = (BILLING_SUMMARY_WINDOWS as readonly number[]).includes(requested)
        ? requested
        : 30;
      const now = (deps.now ?? (() => new Date()))();
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const [result, multiplier] = await Promise.all([
        deps.getBillingSummary({ since }),
        deps.getPriceMultiplier(req),
      ]);
      const effective = typeof multiplier === 'number' && multiplier > 0 ? multiplier : 1;
      return res.status(200).json({
        days,
        since: since.toISOString(),
        priceMultiplier: effective,
        ...result,
        /** What the window's spend cost at provider prices, before the markup. On-server OCR
         *  pages have no provider bill, so they count entirely as margin. */
        estimatedProviderCredits:
          Math.max(0, result.creditsSpentInWindow - (result.creditsSpentLocalInWindow ?? 0)) /
          effective,
      });
    } catch (error) {
      logger.error('[adminBalance] summary error:', error);
      return res.status(500).json({ error: 'Failed to build summary' });
    }
  }

  /** Where one user's credits went in the last 7, 30 or 90 days, to answer "why did my balance
   *  drop": chat messages, background memory, titles, OCR, speech and so on. */
  async function userUsage(req: BillingRequest, res: Response) {
    try {
      if (deps.getUserUsageByContext == null) {
        return res.status(404).json({ error: 'usage_unavailable' });
      }
      const query = (req.query ?? {}) as Record<string, unknown>;
      const target = await resolveTarget(deps, query);
      if (!target.ok) {
        return res.status(target.status).json({ error: target.error });
      }
      const requested = readInt(query.days, 30);
      const days = (BILLING_SUMMARY_WINDOWS as readonly number[]).includes(requested)
        ? requested
        : 30;
      const now = (deps.now ?? (() => new Date()))();
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const usage = await deps.getUserUsageByContext({ userId: target.user.id, since });
      return res
        .status(200)
        .json({ user: target.user, days, since: since.toISOString(), ...usage });
    } catch (error) {
      logger.error('[adminBalance] userUsage error:', error);
      return res.status(500).json({ error: 'Failed to read user usage' });
    }
  }

  return { listPacks, getUserBalance, grant, grantBulk, listUsers, summary, userUsage };
}
