import { logger } from '@librechat/data-schemas';
import { ViolationTypes } from 'librechat-data-provider';
import type { Response } from 'express';
import type { BalanceReservation, CheckBalanceDeps } from '~/middleware/checkBalance';
import type { SpeechCreditTxData } from '~/speech/service';
import type { ServerRequest } from '~/types';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { checkBalance } from '~/middleware/checkBalance';
import { usdToCredits } from '~/speech/pricing';

export interface MediaBillingDeps {
  reserveBalance: CheckBalanceDeps['reserveBalance'];
  renewBalanceReservation: CheckBalanceDeps['renewBalanceReservation'];
  releaseBalanceReservation: CheckBalanceDeps['releaseBalanceReservation'];
  logViolation: CheckBalanceDeps['logViolation'];
  createTransaction: (txData: SpeechCreditTxData) => Promise<unknown>;
}

export interface MediaCharge {
  model: string;
  endpoint: string;
  context: string;
  conversationId?: string;
}

function isBalanceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  try {
    return (JSON.parse(error.message) as { type?: string })?.type === ViolationTypes.TOKEN_BALANCE;
  } catch {
    return false;
  }
}

/** Credits for a dollar price at the endpoint's markup (1,000,000 credits = $1 billed). */
export function mediaCredits(usd: number, priceMultiplier: number): number {
  return Math.ceil(usdToCredits(usd, priceMultiplier));
}

/**
 * Holds and charges credits for one generation, the way server speech does: the estimate is held
 * first so a user cannot spend credit they do not have, the real cost is charged after a success,
 * and nothing is charged when the generation fails.
 */
export interface MediaBilling {
  /** `undefined` when balance is off; `'insufficient'` when the user cannot cover the estimate. */
  hold: (
    req: ServerRequest,
    charge: MediaCharge,
    credits: number,
  ) => Promise<BalanceReservation | 'insufficient' | undefined>;
  /** Records the spend; a failed write is logged, since the user already has the file. */
  record: (req: ServerRequest, charge: MediaCharge, credits: number) => Promise<void>;
}

export function createMediaBilling(deps: MediaBillingDeps): MediaBilling {
  /** `undefined` when balance is off; `'insufficient'` when the user cannot cover the estimate. */
  async function hold(
    req: ServerRequest,
    charge: MediaCharge,
    credits: number,
  ): Promise<BalanceReservation | 'insufficient' | undefined> {
    const balanceConfig = getBalanceConfig(req.config);
    const userId = req.user?.id;
    if (balanceConfig?.enabled !== true || !userId || !(credits > 0)) {
      return undefined;
    }
    try {
      return await checkBalance(
        {
          req,
          res: {} as Response,
          txData: { user: userId, model: charge.model, endpoint: charge.endpoint, amount: credits },
        },
        {
          getMultiplier: () => 1,
          reserveBalance: deps.reserveBalance,
          renewBalanceReservation: deps.renewBalanceReservation,
          releaseBalanceReservation: deps.releaseBalanceReservation,
          logViolation: deps.logViolation,
          balanceConfig: balanceConfig ?? undefined,
        },
      );
    } catch (error) {
      if (isBalanceError(error)) {
        return 'insufficient';
      }
      throw error;
    }
  }

  /** Records the spend; a failed write is logged, since the user already has the file. */
  async function record(req: ServerRequest, charge: MediaCharge, credits: number): Promise<void> {
    const userId = req.user?.id;
    if (!userId || !(credits > 0)) {
      return;
    }
    try {
      await deps.createTransaction({
        user: userId,
        ...(charge.conversationId ? { conversationId: charge.conversationId } : {}),
        model: charge.model,
        endpoint: charge.endpoint,
        context: charge.context,
        tokenType: 'credits',
        rawAmount: -credits,
        endpointTokenConfig: { [charge.model]: { credits: 1 } },
        balance: getBalanceConfig(req.config) ?? undefined,
        transactions: getTransactionsConfig(req.config),
      });
    } catch (error) {
      logger.error('[media] Failed to record the generation charge', {
        userId,
        model: charge.model,
        context: charge.context,
        error,
      });
    }
  }

  return { hold, record };
}
