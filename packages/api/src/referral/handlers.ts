import type { Request, Response } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import type { ReferralDeps } from './service';
import {
  claimReferral,
  getReferralInfo,
  settleReferral,
  resolveReferralSettings,
} from './service';

type AuthedRequest = Request & { user?: { id?: string; role?: string; tenantId?: string } };

export interface ReferralHandlerDeps extends ReferralDeps {
  getAppConfig: (req: AuthedRequest) => Promise<AppConfig | undefined>;
  /** Public origin of the client, where sign-up links point */
  clientOrigin: string;
}

type Handler = (req: AuthedRequest, res: Response) => Promise<Response>;

export interface ReferralHandlers {
  get: Handler;
  claim: Handler;
}

/** Express handlers for `/api/referral`; the JS route only wires them. */
export function createReferralHandlers(deps: ReferralHandlerDeps): ReferralHandlers {
  async function get(req: AuthedRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
      const settings = resolveReferralSettings(await deps.getAppConfig(req));
      if (!settings.enabled) {
        return res.status(404).json({ message: 'Referrals are off' });
      }
      /** Opening the card is also when a reward that waited on a mobile becomes due. */
      await settleReferral(deps, settings, userId).catch(() => undefined);
      return res.json(
        await getReferralInfo(deps, settings, { userId, clientOrigin: deps.clientOrigin }),
      );
    } catch (error) {
      deps.logError?.('[referral] Reading invite info failed', error);
      return res.status(500).json({ message: 'Error reading invite info' });
    }
  }

  async function claim(req: AuthedRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const code = (req.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string' || code.length > 32) {
      return res.status(400).json({ status: 'invalid_code' });
    }
    try {
      const settings = resolveReferralSettings(await deps.getAppConfig(req));
      return res.json(await claimReferral(deps, settings, { userId, code }));
    } catch (error) {
      deps.logError?.('[referral] Claiming an invite failed', error);
      return res.status(500).json({ message: 'Error claiming invite' });
    }
  }

  return { get: get, claim: claim };
}
