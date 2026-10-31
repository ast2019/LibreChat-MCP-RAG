import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { RateLimitInfo, Store } from 'express-rate-limit';
import type { AppConfig } from '@librechat/data-schemas';
import { getRateLimitReset } from '~/utils/limiter';

/** `rateLimits.api` as it applies: requests per user per window. */
export interface ApiRateLimit {
  max: number;
  windowMinutes: number;
}

type ApiLimitedRequest = Request & {
  user?: { id?: string };
  apiKeyId?: string;
  config?: AppConfig;
};

/** The programming API's limit from `rateLimits.api`; null when none is configured. */
export function readApiRateLimit(config: AppConfig | null | undefined): ApiRateLimit | null {
  const settings = (
    config as { rateLimits?: { api?: { userMax?: number; userWindowInMinutes?: number } } }
  )?.rateLimits?.api;
  const max = settings?.userMax;
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    return null;
  }
  const window = settings?.userWindowInMinutes;
  return { max, windowMinutes: typeof window === 'number' && window > 0 ? window : 1 };
}

/**
 * Limits model calls (`/chat/completions`, `/responses`) per user, as `rateLimits.api` sets
 * them; without it nothing is limited. Counted per user rather than per key, so several keys do
 * not multiply the allowance. Refused calls get 429 with `Retry-After` and an OpenAI-shaped
 * `rate_limit_error`, which coding clients retry on their own. `req.config` must be loaded.
 */
export function createApiRequestLimiter({
  createStore,
}: {
  /** A shared store per limit (Redis in production), so every API replica counts the same calls */
  createStore?: (prefix: string) => Store | undefined;
} = {}): RequestHandler {
  const limiters = new Map<string, RequestHandler>();

  const limiterFor = ({ max, windowMinutes }: ApiRateLimit): RequestHandler => {
    const key = `${max}:${windowMinutes}`;
    let limiter = limiters.get(key);
    if (limiter == null) {
      const windowMs = windowMinutes * 60 * 1000;
      const store = createStore?.(`api_user_limiter_${max}_${windowMinutes}`);
      limiter = rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
          const limited = req as ApiLimitedRequest;
          return String(limited.user?.id ?? limited.apiKeyId);
        },
        handler: (req, res) => {
          const { retryAfterSeconds } = getRateLimitReset(
            (req as Request & { rateLimit?: RateLimitInfo }).rateLimit,
            windowMs,
          );
          res.set('Retry-After', String(retryAfterSeconds));
          res
            .status(429)
            .type('application/json')
            .json({
              error: {
                message: `Too many requests: at most ${max} per ${windowMinutes} minute(s). Retry after ${retryAfterSeconds} seconds.`,
                type: 'rate_limit_error',
                code: 'rate_limit_exceeded',
                param: null,
              },
            });
        },
        ...(store != null && { store }),
      });
      limiters.set(key, limiter);
    }
    return limiter;
  };

  return (req, res, next) => {
    const limit = readApiRateLimit((req as ApiLimitedRequest).config);
    if (limit == null) {
      next();
      return;
    }
    return limiterFor(limit)(req, res, next);
  };
}
