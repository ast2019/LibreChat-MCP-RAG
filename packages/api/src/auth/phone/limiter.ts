import { createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import {
  ViolationTypes,
  PhoneAuthErrorCode,
  normalizeIranianMobile,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from 'express-rate-limit';

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

export interface PhoneLimiterDependencies {
  limiterCache: (prefix: string) => Store | undefined;
  removePorts: (req: Request) => string | undefined;
  logViolation: (
    req: Request,
    res: Response,
    type: ViolationTypes,
    message: Record<string, unknown>,
    score: string | number | undefined,
  ) => Promise<void>;
  /** Per-request limits from `registration.phone`, so a config reload applies without restart. */
  resolveLimits: (req: Request) => Promise<{ perPhonePerHour: number; perIpPerHour: number }>;
  /** Verification attempts one number may make per window (atomic across replicas). */
  verifyPerPhone?: number;
  violationScore?: string | number;
}

const HOUR_MS = 60 * 60 * 1000;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/** Keyed by a hash so the limiter store never holds phone numbers. */
const phoneKey = (req: Request): string | null => {
  const phone = normalizeIranianMobile((req.body as { phone?: unknown } | undefined)?.phone);
  return phone ? `phone:${createHash('sha256').update(phone).digest('hex').slice(0, 40)}` : null;
};

/**
 * Rate limits for the phone code routes: per IP and per number for code requests (rolling hour,
 * from config), and per number for verification. Each rejection is logged as a login violation
 * and answered with the stable `phone_rate_limited` code.
 */
export function createPhoneLimiters(deps: PhoneLimiterDependencies): {
  phoneCodeRequestLimiter: Middleware;
  phoneCodeVerifyLimiter: Middleware;
} {
  const handler =
    (limiter: string, windowMs: number) =>
    async (req: Request, res: Response): Promise<void> => {
      const type = ViolationTypes.LOGINS;
      await deps.logViolation(
        req,
        res,
        type,
        { type, limiter, windowInMinutes: windowMs / 60000 },
        deps.violationScore,
      );
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfterSeconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      res.status(429).json({ code: PhoneAuthErrorCode.RATE_LIMITED, retryAfterSeconds });
    };

  const ipKey = (req: Request): string => `ip:${deps.removePorts(req) ?? 'unknown'}`;

  const requestIp = rateLimit({
    windowMs: HOUR_MS,
    limit: async (req: Request) => (await deps.resolveLimits(req)).perIpPerHour,
    handler: handler('phone_request_ip', HOUR_MS),
    keyGenerator: ipKey,
    store: deps.limiterCache('phone_request_ip_limiter'),
    validate: false,
  });
  const requestPhone = rateLimit({
    windowMs: HOUR_MS,
    limit: async (req: Request) => (await deps.resolveLimits(req)).perPhonePerHour,
    skip: (req) => phoneKey(req) == null,
    handler: handler('phone_request_phone', HOUR_MS),
    keyGenerator: (req) => phoneKey(req) ?? 'phone:invalid',
    store: deps.limiterCache('phone_request_phone_limiter'),
    validate: false,
  });
  const verifyPhone = rateLimit({
    windowMs: VERIFY_WINDOW_MS,
    limit: deps.verifyPerPhone ?? 15,
    skip: (req) => phoneKey(req) == null,
    handler: handler('phone_verify_phone', VERIFY_WINDOW_MS),
    keyGenerator: (req) => phoneKey(req) ?? 'phone:invalid',
    store: deps.limiterCache('phone_verify_phone_limiter'),
    validate: false,
  });

  const chain =
    (first: Middleware, second: Middleware): Middleware =>
    (req, res, next) =>
      first(req, res, (err?: unknown) => (err ? next(err) : second(req, res, next)));

  return {
    phoneCodeRequestLimiter: chain(requestIp, requestPhone),
    phoneCodeVerifyLimiter: verifyPhone,
  };
}
