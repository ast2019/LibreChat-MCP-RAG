import rateLimit from 'express-rate-limit';
import { logger } from '@librechat/data-schemas';
import type { Request, Response, RequestHandler } from 'express';
import type { RateLimitInfo, Store } from 'express-rate-limit';
import type { AppConfig } from '@librechat/data-schemas';
import { getRateLimitReset } from '~/utils/limiter';
import { removePorts } from '~/utils/ports';

/** `rateLimits.paymentCallback` as it applies: gateway returns per source address per window. */
export interface PaymentCallbackRateLimit {
  max: number;
  windowMinutes: number;
}

/** Generous on purpose: every buyer returns once per payment, and carriers share addresses. */
export const DEFAULT_PAYMENT_CALLBACK_RATE_LIMIT: PaymentCallbackRateLimit = {
  max: 60,
  windowMinutes: 1,
};

/** The callback limit from `rateLimits.paymentCallback`, or the default. */
export function readPaymentCallbackRateLimit(
  config: AppConfig | null | undefined,
): PaymentCallbackRateLimit {
  const settings = (
    config as {
      rateLimits?: { paymentCallback?: { ipMax?: number; ipWindowInMinutes?: number } };
    } | null
  )?.rateLimits?.paymentCallback;
  const max = settings?.ipMax;
  const window = settings?.ipWindowInMinutes;
  return {
    max:
      typeof max === 'number' && Number.isInteger(max) && max > 0
        ? max
        : DEFAULT_PAYMENT_CALLBACK_RATE_LIMIT.max,
    windowMinutes:
      typeof window === 'number' && window > 0
        ? window
        : DEFAULT_PAYMENT_CALLBACK_RATE_LIMIT.windowMinutes,
  };
}

export interface PaymentCallbackLimiterDeps {
  /** The base app config (the route has no signed-in user) */
  getConfig: () => Promise<AppConfig | null | undefined>;
  /** A shared store per limit (Redis in production), so every replica counts the same returns */
  createStore?: (prefix: string) => Store | undefined;
  /** Answers a refused return; the payment handlers send the buyer to the pending result page */
  onLimited: (req: Request, res: Response) => unknown;
}

/**
 * Limits the unauthenticated payment callback per source address, as
 * `rateLimits.paymentCallback` sets it (60 per minute by default). A refused return is handed
 * to `onLimited` with `Retry-After` set; the order stays as it was, so a later return or
 * reconciliation settles it.
 */
export function createPaymentCallbackLimiter(deps: PaymentCallbackLimiterDeps): RequestHandler {
  const limiters = new Map<string, RequestHandler>();

  const limiterFor = ({ max, windowMinutes }: PaymentCallbackRateLimit): RequestHandler => {
    const key = `${max}:${windowMinutes}`;
    let limiter = limiters.get(key);
    if (limiter == null) {
      const windowMs = windowMinutes * 60 * 1000;
      const store = deps.createStore?.(`payment_callback_limiter_${max}_${windowMinutes}`);
      limiter = rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: removePorts,
        handler: (req, res) => {
          const { retryAfterSeconds } = getRateLimitReset(
            (req as Request & { rateLimit?: RateLimitInfo }).rateLimit,
            windowMs,
          );
          res.set('Retry-After', String(retryAfterSeconds));
          logger.warn('[payments] callback rate limit reached');
          return deps.onLimited(req, res);
        },
        ...(store != null && { store }),
      });
      limiters.set(key, limiter);
    }
    return limiter;
  };

  /** Built up front so the common case never creates a limiter inside a request */
  limiterFor(DEFAULT_PAYMENT_CALLBACK_RATE_LIMIT);

  return async (req, res, next) => {
    let limit = DEFAULT_PAYMENT_CALLBACK_RATE_LIMIT;
    try {
      limit = readPaymentCallbackRateLimit(await deps.getConfig());
    } catch (error) {
      logger.warn('[payments] callback limiter could not read the config; using the default', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
    return limiterFor(limit)(req, res, next);
  };
}
