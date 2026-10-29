import { logger } from '@librechat/data-schemas';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import { getBalanceConfig } from '~/app/config';

type ApiUserRequest = Request & {
  user?: { id?: string; role?: string; apiAccess?: boolean | null };
  config?: AppConfig;
};

/**
 * Lets a user's own programming API override win over their role: `true` admits them, `false`
 * refuses them, and anything else falls through to the role check (`REMOTE_AGENTS.USE`). The
 * override is read from the user already loaded by authentication, never from the database.
 */
export function createCheckApiAccess(roleCheck: RequestHandler): RequestHandler {
  return (baseReq, res, next) => {
    const req = baseReq as ApiUserRequest;
    const override = req.user?.apiAccess;
    if (override === true) {
      next();
      return;
    }
    if (override === false) {
      res.status(403).json({
        error: {
          message: 'API access is turned off for this account',
          type: 'permission_error',
          code: 'api_access_disabled',
        },
      });
      return;
    }
    return roleCheck(baseReq, res, next);
  };
}

export interface RequireApiBalanceDeps {
  findBalanceByUser: (userId: string) => Promise<{ tokenCredits?: number } | null>;
}

/**
 * Refuses an API call before it reaches a provider when balance is enabled and the user has no
 * credit left, as the chat composer does. Usage is still charged after the run as in chat.
 */
export function createRequireApiBalance(deps: RequireApiBalanceDeps): RequestHandler {
  return async (baseReq: Request, res: Response, next: NextFunction): Promise<void> => {
    const req = baseReq as ApiUserRequest;
    const balanceConfig = getBalanceConfig(req.config);
    const userId = req.user?.id;
    if (balanceConfig?.enabled !== true || !userId) {
      next();
      return;
    }
    try {
      const balance = await deps.findBalanceByUser(userId);
      if ((balance?.tokenCredits ?? 0) > 0) {
        next();
        return;
      }
      res.status(402).json({
        error: {
          message: 'No credit left. Buy a pack to keep using the API.',
          type: 'insufficient_quota',
          code: 'insufficient_balance',
        },
      });
    } catch (error) {
      logger.error('[requireApiBalance] Balance lookup failed', error);
      res.status(500).json({
        error: { message: 'Could not check balance', type: 'server_error', code: 'internal_error' },
      });
    }
  };
}
