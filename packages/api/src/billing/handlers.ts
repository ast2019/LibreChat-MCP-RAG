import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { TBalancePack, TBalanceConfig } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { GrantBalanceDeps } from './packs';
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
} {
  async function listPacks(req: BillingRequest, res: Response) {
    try {
      const config = await deps.getBalanceConfig(req);
      const packs: TBalancePack[] = config?.packs ?? [];
      return res.status(200).json({ enabled: config?.enabled === true, packs });
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

  return { listPacks, getUserBalance, grant };
}
