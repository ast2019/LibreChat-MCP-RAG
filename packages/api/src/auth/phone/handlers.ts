import { logger } from '@librechat/data-schemas';
import {
  SystemRoles,
  PhoneAuthErrorCode,
  maskPhone,
  normalizeIranianMobile,
} from 'librechat-data-provider';
import type { AppConfig, CreateUserIfAbsentResult, NewUserData } from '@librechat/data-schemas';
import type { PhoneOtpPurpose } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { ResolvedPhoneLogin, PhoneLoginEnv } from './config';
import type { IssueCodeResult, VerifyCodeResult } from './otp';
import type { UserDocumentId } from '~/auth/verification';
import type { GetAppConfigOptions } from '~/app/service';
import type { OtpStore, SmsProvider } from './types';
import { resolveAppConfigForUser, resolvePreAuthAppConfig } from '~/app/resolve';
import { resolvePhoneLoginConfig } from './config';
import { createPhoneOtpService } from './otp';

const LOCAL_PROVIDER = 'local';
const MAX_NAME_LENGTH = 80;

/** The account fields the phone routes read, as plain data. */
export interface PhoneAccount {
  _id: UserDocumentId;
  id?: string;
  email?: string;
  phone?: string;
  phoneVerified?: boolean;
  name?: string;
  provider?: string;
  role?: string;
  tenantId?: string;
  password?: string;
}

type PhoneBody = { phone?: unknown; code?: unknown; name?: unknown; password?: unknown };

export type PhoneRequest = Request<Record<string, string>, object, PhoneBody | undefined> & {
  user?: PhoneAccount;
  banned?: boolean;
};

type AuthenticatedPhoneRequest = PhoneRequest & { user: PhoneAccount & { id: string } };
type NextCallback = (err?: Error) => void;
type GetAppConfig = (options: GetAppConfigOptions) => Promise<AppConfig>;

export interface PhoneAuthHandlersDeps {
  env: PhoneLoginEnv;
  getAppConfig: GetAppConfig;
  /** Store backing codes and cooldowns (Redis-backed Keyv in production). */
  getStore: () => OtpStore;
  /** HMAC key for stored codes; the deployment's JWT secret by default. */
  secret: string;
  createSmsProvider: (config: ResolvedPhoneLogin) => SmsProvider;
  findUserByPhone: (phone: string) => Promise<PhoneAccount | null>;
  getUserById: (userId: string, fields?: string) => Promise<PhoneAccount | null>;
  createUserIfAbsent: (
    data: NewUserData,
    balanceConfig?: AppConfig['balance'],
  ) => Promise<CreateUserIfAbsentResult>;
  /** Only consulted outside a tenant, to bootstrap the first account as ADMIN. */
  countUsers: () => Promise<number>;
  getTenantId: () => string | undefined;
  /** Invalidates the auth user cache (data-schemas `updateUser` does). */
  updateUser: (
    userId: UserDocumentId,
    update: Partial<Pick<PhoneAccount, 'phone' | 'phoneVerified' | 'name'>>,
  ) => Promise<PhoneAccount | null>;
  unsetUserPhone: (userId: string) => Promise<PhoneAccount | null>;
  comparePassword: (user: { password: string }, candidate: string) => Promise<boolean>;
  checkBan: (req: PhoneRequest, res: Response, next: NextCallback) => Promise<Response | void>;
  /** Overrides for tests. */
  now?: () => number;
  pad?: () => Promise<void>;
  generateCode?: () => string;
}

const fail = (
  res: Response,
  status: number,
  code: PhoneAuthErrorCode,
  extra?: Record<string, unknown>,
): Response => res.status(status).json({ code, ...extra });

const serverError = (res: Response, tag: string, err: unknown): Response => {
  logger.error(
    `[${tag}]`,
    err instanceof Error ? { name: err.name, code: (err as { code?: unknown }).code } : {},
  );
  return res.status(500).json({ message: 'Something went wrong' });
};

const isDuplicateKeyError = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === 11000;

/** Maps an issue result onto the wire contract shared by login and link requests. */
function sendIssueResult(res: Response, result: IssueCodeResult, phone: string): Response {
  if (result.ok) {
    return res.status(200).json({ sent: true, ...result.value });
  }
  if (result.error.code === 'cooldown') {
    return fail(res, 429, PhoneAuthErrorCode.COOLDOWN, {
      retryAfterSeconds: result.error.retryAfterSeconds,
    });
  }
  logger.warn('[phoneAuth] SMS provider rejected a code', {
    phone: maskPhone(phone),
    providerCode: result.error.providerCode,
    status: result.error.status,
  });
  return fail(res, 502, PhoneAuthErrorCode.SEND_FAILED);
}

function sendVerifyFailure(
  res: Response,
  result: Exclude<VerifyCodeResult, { ok: true }>,
): Response {
  switch (result.error.code) {
    case 'invalid':
      return fail(res, 400, PhoneAuthErrorCode.INVALID_CODE, {
        attemptsRemaining: result.error.attemptsRemaining,
      });
    case 'too_many_attempts':
      return fail(res, 429, PhoneAuthErrorCode.TOO_MANY_ATTEMPTS);
    default:
      return fail(res, 400, PhoneAuthErrorCode.EXPIRED);
  }
}

const sanitizeName = (input: unknown): string | undefined => {
  if (typeof input !== 'string') {
    return undefined;
  }
  const name = Array.from(input)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || undefined;
};

/**
 * Phone one-time-code routes. `verifyLoginCode` populates `req.user` and hands off to the shared
 * `loginController`, so phone sign-in gets the same 2FA gating, ban checks and token issuance as
 * password and passkey sign-in.
 *
 * Enumeration safety: a code request for a valid number answers identically whether or not an
 * account exists. When the number may not sign in (unknown with registration closed, or held by
 * a non-local account) nothing is sent or stored, the cooldown is still recorded, and the
 * response is padded to the duration of a real send.
 */
/** Express handlers of phone sign-in and phone management (see {@link createPhoneAuthHandlers}). */
export interface PhoneAuthHandlers {
  resolveLimits: () => Promise<{ perPhonePerHour: number; perIpPerHour: number }>;
  requestLoginCode: (req: PhoneRequest, res: Response) => Promise<Response>;
  verifyLoginCode: (req: PhoneRequest, res: Response, next: () => void) => Promise<Response | void>;
  requestLinkCode: (req: AuthenticatedPhoneRequest, res: Response) => Promise<Response>;
  verifyLinkCode: (req: AuthenticatedPhoneRequest, res: Response) => Promise<Response>;
  removePhone: (req: AuthenticatedPhoneRequest, res: Response) => Promise<Response>;
  updateProfile: (req: AuthenticatedPhoneRequest, res: Response) => Promise<Response>;
}

export function createPhoneAuthHandlers(deps: PhoneAuthHandlersDeps): PhoneAuthHandlers {
  const resolve = async (): Promise<{ config: ResolvedPhoneLogin; appConfig: AppConfig }> => {
    const appConfig = await resolvePreAuthAppConfig(deps.getAppConfig);
    return {
      appConfig,
      config: resolvePhoneLoginConfig(appConfig?.registration?.phone, deps.env),
    };
  };

  const otpFor = (config: ResolvedPhoneLogin) =>
    createPhoneOtpService({
      store: deps.getStore(),
      sms: deps.createSmsProvider(config),
      secret: deps.secret,
      now: deps.now,
      pad: deps.pad,
      generateCode: deps.generateCode,
    });

  /** Rate-limit key resolution for `createPhoneLimiters`. */
  const resolveLimits = async () => (await resolve()).config.limits;

  const requireLocal = (res: Response, user: PhoneAccount): boolean => {
    if ((user.provider ?? LOCAL_PROVIDER) === LOCAL_PROVIDER) {
      return true;
    }
    fail(res, 403, PhoneAuthErrorCode.ACCOUNT_UNAVAILABLE);
    return false;
  };

  /** Password step-up for identifier changes; accounts without a password skip it. */
  const confirmPassword = async (req: AuthenticatedPhoneRequest, res: Response) => {
    const account = await deps.getUserById(req.user.id, '+password');
    if (!account?.password) {
      return true;
    }
    const password = req.body?.password;
    const ok =
      typeof password === 'string' &&
      password.length > 0 &&
      (await deps.comparePassword({ password: account.password }, password).catch(() => false));
    if (!ok) {
      logger.warn(`[phoneAuth] Step-up failed [User: ${req.user.id}] [Request-IP: ${req.ip}]`);
      fail(res, 403, PhoneAuthErrorCode.PASSWORD_INVALID);
    }
    return ok;
  };

  async function requestLoginCode(req: PhoneRequest, res: Response): Promise<Response> {
    try {
      const { config } = await resolve();
      if (!config.enabled) {
        return fail(res, 404, PhoneAuthErrorCode.DISABLED);
      }
      const phone = normalizeIranianMobile(req.body?.phone);
      if (!phone) {
        return fail(res, 400, PhoneAuthErrorCode.INVALID_PHONE);
      }
      let deliver = true;
      if (!config.allowRegistration) {
        const user = await deps.findUserByPhone(phone);
        deliver = user != null && (user.provider ?? LOCAL_PROVIDER) === LOCAL_PROVIDER;
      }
      const result = await otpFor(config).issueCode({
        phone,
        purpose: 'login',
        policy: config.policy,
        deliver,
      });
      return sendIssueResult(res, result, phone);
    } catch (err) {
      return serverError(res, 'requestLoginCode', err);
    }
  }

  const createPhoneUser = async (
    phone: string,
    name: string | undefined,
  ): Promise<PhoneAccount | null> => {
    const tenantId = deps.getTenantId();
    const userCount = tenantId ? null : await deps.countUsers();
    const role = userCount === 0 ? SystemRoles.ADMIN : SystemRoles.USER;
    const appConfig = await resolveAppConfigForUser(deps.getAppConfig, { role });
    const created = await deps.createUserIfAbsent(
      {
        provider: LOCAL_PROVIDER,
        phone,
        phoneVerified: true,
        emailVerified: false,
        role,
        ...(name ? { name } : {}),
      },
      appConfig?.balance,
    );
    if (created.ok) {
      logger.info(`[phoneAuth] Registered a phone account [User ID: ${created.value._id}]`);
      return created.value as unknown as PhoneAccount;
    }
    /** A concurrent verification created it first. */
    return deps.findUserByPhone(phone);
  };

  async function verifyLoginCode(
    req: PhoneRequest,
    res: Response,
    next: () => void,
  ): Promise<Response | void> {
    try {
      const { config } = await resolve();
      if (!config.enabled) {
        return fail(res, 404, PhoneAuthErrorCode.DISABLED);
      }
      const phone = normalizeIranianMobile(req.body?.phone);
      if (!phone) {
        return fail(res, 400, PhoneAuthErrorCode.INVALID_PHONE);
      }
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const verified = await otpFor(config).verifyCode({
        phone,
        code,
        purpose: 'login',
        policy: config.policy,
      });
      if (!verified.ok) {
        logger.warn(
          `[phoneAuth] Code verification failed [${verified.error.code}] [Request-IP: ${req.ip}]`,
        );
        return sendVerifyFailure(res, verified);
      }

      let user = await deps.findUserByPhone(phone);
      if (!user) {
        if (!config.allowRegistration) {
          return fail(res, 403, PhoneAuthErrorCode.REGISTRATION_CLOSED);
        }
        user = await createPhoneUser(phone, sanitizeName(req.body?.name));
      }
      if (!user) {
        return fail(res, 403, PhoneAuthErrorCode.ACCOUNT_UNAVAILABLE);
      }
      if (!requireLocal(res, user)) {
        return;
      }
      if (!user.phoneVerified) {
        user = (await deps.updateUser(user._id, { phoneVerified: true })) ?? user;
      }

      req.user = user;
      /** See `authenticatePasskey`: a ban check that cannot complete must not admit anyone. */
      let banError: Error | undefined;
      await deps.checkBan(req, res, (err) => {
        banError = err;
      });
      if (banError) {
        logger.error('[phoneAuth] Ban check failed to complete', banError);
        return res.headersSent
          ? undefined
          : res.status(500).json({ message: 'Something went wrong' });
      }
      if (req.banned || res.headersSent) {
        return;
      }
      return next();
    } catch (err) {
      return serverError(res, 'verifyLoginCode', err);
    }
  }

  const linkPurpose: PhoneOtpPurpose = 'link';

  async function requestLinkCode(req: AuthenticatedPhoneRequest, res: Response): Promise<Response> {
    try {
      const { config } = await resolve();
      if (!config.enabled) {
        return fail(res, 404, PhoneAuthErrorCode.DISABLED);
      }
      if (!requireLocal(res, req.user)) {
        return res;
      }
      const phone = normalizeIranianMobile(req.body?.phone);
      if (!phone) {
        return fail(res, 400, PhoneAuthErrorCode.INVALID_PHONE);
      }
      if (!(await confirmPassword(req, res))) {
        return res;
      }
      const result = await otpFor(config).issueCode({
        phone,
        purpose: linkPurpose,
        subject: req.user.id,
        policy: config.policy,
      });
      return sendIssueResult(res, result, phone);
    } catch (err) {
      return serverError(res, 'requestLinkCode', err);
    }
  }

  /**
   * Links the verified number. Whether it belongs to another account is only revealed after the
   * caller proved they hold the number, so the check cannot be used to enumerate.
   */
  async function verifyLinkCode(req: AuthenticatedPhoneRequest, res: Response): Promise<Response> {
    try {
      const { config } = await resolve();
      if (!config.enabled) {
        return fail(res, 404, PhoneAuthErrorCode.DISABLED);
      }
      if (!requireLocal(res, req.user)) {
        return res;
      }
      const phone = normalizeIranianMobile(req.body?.phone);
      if (!phone) {
        return fail(res, 400, PhoneAuthErrorCode.INVALID_PHONE);
      }
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const verified = await otpFor(config).verifyCode({
        phone,
        code,
        purpose: linkPurpose,
        subject: req.user.id,
        policy: config.policy,
      });
      if (!verified.ok) {
        return sendVerifyFailure(res, verified);
      }
      const holder = await deps.findUserByPhone(phone);
      if (holder && holder._id.toString() !== req.user.id) {
        return fail(res, 409, PhoneAuthErrorCode.PHONE_IN_USE);
      }
      try {
        await deps.updateUser(req.user.id, { phone, phoneVerified: true });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          return fail(res, 409, PhoneAuthErrorCode.PHONE_IN_USE);
        }
        throw err;
      }
      logger.info(`[phoneAuth] Phone linked [User ID: ${req.user.id}] [${maskPhone(phone)}]`);
      return res.status(200).json({ phone, phoneVerified: true });
    } catch (err) {
      return serverError(res, 'verifyLinkCode', err);
    }
  }

  /** Removes the number; refused when it is the account's only identifier. */
  async function removePhone(req: AuthenticatedPhoneRequest, res: Response): Promise<Response> {
    try {
      const account = await deps.getUserById(req.user.id, 'email phone');
      if (!account?.phone) {
        return res.status(200).json({ phone: null });
      }
      if (!account.email) {
        return fail(res, 400, PhoneAuthErrorCode.ONLY_IDENTIFIER);
      }
      if (!(await confirmPassword(req, res))) {
        return res;
      }
      await deps.unsetUserPhone(req.user.id);
      logger.info(`[phoneAuth] Phone removed [User ID: ${req.user.id}]`);
      return res.status(200).json({ phone: null });
    } catch (err) {
      return serverError(res, 'removePhone', err);
    }
  }

  /** Sets the display name, used by the optional step after a phone sign-up. */
  async function updateProfile(req: AuthenticatedPhoneRequest, res: Response): Promise<Response> {
    try {
      const name = sanitizeName(req.body?.name);
      if (!name) {
        return fail(res, 400, PhoneAuthErrorCode.NAME_INVALID);
      }
      await deps.updateUser(req.user.id, { name });
      return res.status(200).json({ name });
    } catch (err) {
      return serverError(res, 'updateProfile', err);
    }
  }

  return {
    resolveLimits,
    requestLoginCode,
    verifyLoginCode,
    requestLinkCode,
    verifyLinkCode,
    removePhone,
    updateProfile,
  };
}
