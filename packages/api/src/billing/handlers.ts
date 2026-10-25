import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { IUser, BillingSummary, BillingUserRow } from '@librechat/data-schemas';
import type { TBalancePack, TBalanceConfig } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { RialRate, RialRateRegistry } from './rial';
import type { GrantBalanceDeps } from './packs';
import { grantBalance, resolveBalanceGrant } from './packs';
import { creditsToUsd, priceInRial } from './rial';

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
  listUsersWithBalances: (params: {
    search?: string;
    limit?: number;
    offset?: number;
  }) => Promise<{ users: BillingUserRow[]; total: number }>;
  getBillingSummary: (params: { since: Date }) => Promise<BillingSummary>;
  /** Markup applied to provider prices; the summary divides spend by it to estimate cost. */
  getPriceMultiplier: (req: BillingRequest) => Promise<number | undefined>;
  /** Prices packs in rial; omission leaves every rial figure null. */
  rialRates?: RialRateRegistry;
  now?: () => Date;
}

export interface BalancePacksDeps {
  /** Balance settings that apply to the requesting user's deployment/tenant. */
  getBalanceConfig: (req: BillingRequest) => Promise<Partial<TBalanceConfig> | null>;
  rialRates?: RialRateRegistry;
}

/** The rate packs are priced at; null when rial pricing is off or no rate is available. */
async function resolveRialRate(
  rialRates: RialRateRegistry | undefined,
  config: Partial<TBalanceConfig> | null,
): Promise<{ rate: RialRate; roundTo: number } | null> {
  if (rialRates == null || config?.rial?.enabled !== true) {
    return null;
  }
  const result = await rialRates.getRate(config.rial);
  if (result == null || !result.ok) {
    return null;
  }
  return { rate: result.value, roundTo: config.rial.roundTo ?? 1 };
}

function packPriceRial(
  pack: TBalancePack,
  rial: { rate: RialRate; roundTo: number } | null,
): number | null {
  return rial ? priceInRial(pack.credits, rial.rate.rate, rial.roundTo) : null;
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
  listUsers: (req: BillingRequest, res: Response) => Promise<Response>;
  summary: (req: BillingRequest, res: Response) => Promise<Response>;
} {
  async function listPacks(req: BillingRequest, res: Response) {
    try {
      const config = await deps.getBalanceConfig(req);
      const rial = await resolveRialRate(deps.rialRates, config);
      const packs = (config?.packs ?? []).map((pack) => ({
        ...pack,
        priceUsd: creditsToUsd(pack.credits),
        priceRial: packPriceRial(pack, rial),
      }));
      return res.status(200).json({
        enabled: config?.enabled === true,
        packs,
        rial: rial ? { enabled: true, ...rial.rate } : null,
      });
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

  async function listUsers(req: BillingRequest, res: Response) {
    try {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const search = typeof query.search === 'string' ? query.search : undefined;
      const limit = Math.min(Math.max(readInt(query.limit, 25), 1), 100);
      const offset = Math.max(readInt(query.offset, 0), 0);
      const { users, total } = await deps.listUsersWithBalances({ search, limit, offset });
      return res.status(200).json({
        total,
        limit,
        offset,
        users: users.map((user) => ({
          ...user,
          usedPercent: getAllotmentUsedPercent(user.balance),
        })),
      });
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
      const [result, multiplier, rial] = await Promise.all([
        deps.getBillingSummary({ since }),
        deps.getPriceMultiplier(req),
        deps.getBalanceConfig(req).then((config) => resolveRialRate(deps.rialRates, config)),
      ]);
      const effective = typeof multiplier === 'number' && multiplier > 0 ? multiplier : 1;
      return res.status(200).json({
        days,
        since: since.toISOString(),
        priceMultiplier: effective,
        ...result,
        /** What the window's spend cost at provider prices, before the markup */
        estimatedProviderCredits: result.creditsSpentInWindow / effective,
        rialPerUsd: rial?.rate.rate ?? null,
      });
    } catch (error) {
      logger.error('[adminBalance] summary error:', error);
      return res.status(500).json({ error: 'Failed to build summary' });
    }
  }

  return { listPacks, getUserBalance, grant, listUsers, summary };
}

/**
 * `GET /api/balance/packs`: the packs a signed-in user can buy, priced in rial only. USD
 * values and the exchange rate stay server-side. Callers mount it behind authentication.
 */
export function createBalancePacksHandler(
  deps: BalancePacksDeps,
): (req: BillingRequest, res: Response) => Promise<Response> {
  return async function listUserPacks(req, res) {
    try {
      const config = await deps.getBalanceConfig(req);
      if (config?.enabled !== true) {
        return res.status(200).json({ enabled: false, packs: [] });
      }
      const rial = await resolveRialRate(deps.rialRates, config);
      const packs = (config.packs ?? []).map((pack) => ({
        id: pack.id,
        label: pack.label,
        ...(pack.description != null ? { description: pack.description } : {}),
        priceRial: packPriceRial(pack, rial),
      }));
      const purchaseUrl = config.purchaseUrl;
      return res.status(200).json({
        enabled: true,
        packs,
        ...(typeof purchaseUrl === 'string' && purchaseUrl !== '' ? { purchaseUrl } : {}),
      });
    } catch (error) {
      logger.error('[balance] listUserPacks error:', error);
      return res.status(500).json({ error: 'Failed to list packs' });
    }
  };
}
