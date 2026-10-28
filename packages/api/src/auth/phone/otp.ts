import { toAsciiDigits } from 'librechat-data-provider';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PhoneOtpPurpose } from 'librechat-data-provider';
import type { OtpStore, PhoneOtpPolicy, SmsProvider } from './types';

export const PHONE_OTP_LENGTH = 6;

interface OtpRecord {
  /** HMAC(secret, salt | purpose | subject | phone | code), hex. */
  h: string;
  /** Per-code random salt, hex. */
  s: string;
  /** Failed verification attempts so far. */
  a: number;
  /** Expiry, epoch ms. */
  x: number;
}

const isOtpRecord = (value: unknown): value is OtpRecord => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.h === 'string' &&
    typeof record.s === 'string' &&
    typeof record.a === 'number' &&
    typeof record.x === 'number'
  );
};

export type IssueCodeResult =
  | { ok: true; value: { cooldownSeconds: number; expiresInSeconds: number; codeLength: number } }
  | { ok: false; error: { code: 'cooldown'; retryAfterSeconds: number } }
  | { ok: false; error: { code: 'send_failed'; providerCode: string; status?: number } };

export type VerifyCodeResult =
  | { ok: true }
  | { ok: false; error: { code: 'invalid'; attemptsRemaining: number } }
  | { ok: false; error: { code: 'expired' } }
  | { ok: false; error: { code: 'too_many_attempts' } };

export interface PhoneOtpServiceDeps {
  store: OtpStore;
  sms: SmsProvider;
  /** Server-side HMAC key; codes and phone numbers are never stored in the clear. */
  secret: string;
  now?: () => number;
  generateCode?: () => string;
  /** Waits out a request that sends nothing, so it takes about as long as one that sends. */
  pad?: () => Promise<void>;
}

export interface IssueCodeInput {
  phone: string;
  purpose: PhoneOtpPurpose;
  policy: PhoneOtpPolicy;
  /** Binds the code to an account (the signed-in user for `link`). */
  subject?: string;
  /**
   * `false` records the cooldown and answers exactly as a real send would, without sending or
   * storing a code: used when the number may not sign in, so the response cannot reveal it.
   */
  deliver?: boolean;
}

export interface VerifyCodeInput {
  phone: string;
  purpose: PhoneOtpPurpose;
  code: string;
  policy: PhoneOtpPolicy;
  subject?: string;
}

const randomCode = (): string =>
  randomInt(0, 10 ** PHONE_OTP_LENGTH)
    .toString()
    .padStart(PHONE_OTP_LENGTH, '0');

const randomPad = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 250 + randomInt(0, 500)));

/** Accepts Persian/Arabic digits and stray spaces; anything else is not a code. */
export function normalizeOtpCode(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const code = toAsciiDigits(input).replace(/\s+/g, '');
  return new RegExp(`^\\d{${PHONE_OTP_LENGTH}}$`).test(code) ? code : null;
}

/**
 * One-time phone codes: crypto-random, stored only as a salted HMAC with a TTL, single use,
 * bounded verification attempts, and a resend cooldown. Codes are bound to a purpose (and to a
 * subject when given), so a `login` code cannot link a number and vice versa.
 *
 * Attempt counting is read-modify-write on the store; concurrent guesses are bounded by the
 * per-number verification limiter in front of the route, which counts atomically.
 */
/** Issues and verifies one-time codes (see {@link createPhoneOtpService}). */
export interface PhoneOtpService {
  issueCode: (input: IssueCodeInput) => Promise<IssueCodeResult>;
  verifyCode: (input: VerifyCodeInput) => Promise<VerifyCodeResult>;
}

export function createPhoneOtpService(deps: PhoneOtpServiceDeps): PhoneOtpService {
  if (!deps.secret) {
    throw new Error('Phone OTP secret is required');
  }
  const now = deps.now ?? Date.now;
  const generateCode = deps.generateCode ?? randomCode;
  const pad = deps.pad ?? randomPad;

  const hmac = (...parts: string[]): string =>
    createHmac('sha256', deps.secret).update(parts.join('\u0000')).digest('hex');

  /** Store keys carry a keyed hash of the number, not the number itself. */
  const keys = (phone: string, purpose: PhoneOtpPurpose, subject = '') => {
    const id = hmac('phone', phone).slice(0, 40);
    return {
      code: `otp:${purpose}:${subject}:${id}`,
      cooldown: `otp_cd:${purpose}:${subject}:${id}`,
    };
  };

  const digest = (salt: string, input: VerifyCodeInput | IssueCodeInput, code: string): string =>
    hmac('code', salt, input.purpose, input.subject ?? '', input.phone, code);

  async function issueCode(input: IssueCodeInput): Promise<IssueCodeResult> {
    const { policy, deliver = true } = input;
    const k = keys(input.phone, input.purpose, input.subject);
    const current = now();

    const cooldownUntil = Number(await deps.store.get(k.cooldown));
    if (Number.isFinite(cooldownUntil) && cooldownUntil > current) {
      return {
        ok: false,
        error: { code: 'cooldown', retryAfterSeconds: Math.ceil((cooldownUntil - current) / 1000) },
      };
    }

    const cooldownMs = policy.resendCooldownSeconds * 1000;
    const ttlMs = policy.codeTtlSeconds * 1000;
    await deps.store.set(k.cooldown, current + cooldownMs, cooldownMs);
    const success: IssueCodeResult = {
      ok: true,
      value: {
        cooldownSeconds: policy.resendCooldownSeconds,
        expiresInSeconds: policy.codeTtlSeconds,
        codeLength: PHONE_OTP_LENGTH,
      },
    };

    if (!deliver) {
      await pad();
      return success;
    }

    const code = generateCode();
    const salt = randomBytes(16).toString('hex');
    const record: OtpRecord = { h: digest(salt, input, code), s: salt, a: 0, x: current + ttlMs };
    await deps.store.set(k.code, record, ttlMs);

    const sent = await deps.sms.sendCode({ phone: input.phone, code }).catch(async (err) => {
      await Promise.all([deps.store.delete(k.code), deps.store.delete(k.cooldown)]);
      throw err;
    });
    if (!sent.ok) {
      await Promise.all([deps.store.delete(k.code), deps.store.delete(k.cooldown)]);
      return {
        ok: false,
        error: { code: 'send_failed', providerCode: sent.error.code, status: sent.error.status },
      };
    }
    return success;
  }

  async function verifyCode(input: VerifyCodeInput): Promise<VerifyCodeResult> {
    const { policy } = input;
    const k = keys(input.phone, input.purpose, input.subject);
    const stored = await deps.store.get(k.code);
    const current = now();

    if (!isOtpRecord(stored)) {
      return { ok: false, error: { code: 'expired' } };
    }
    if (stored.x <= current) {
      await deps.store.delete(k.code);
      return { ok: false, error: { code: 'expired' } };
    }
    if (stored.a >= policy.maxAttempts) {
      await deps.store.delete(k.code);
      return { ok: false, error: { code: 'too_many_attempts' } };
    }

    const attempts = stored.a + 1;
    const code = normalizeOtpCode(input.code);
    const expected = Buffer.from(stored.h, 'hex');
    const actual = Buffer.from(digest(stored.s, input, code ?? ''), 'hex');
    const matches =
      code != null && expected.length === actual.length && timingSafeEqual(expected, actual);

    if (matches) {
      /** `delete` reports removal to exactly one caller, so a code is redeemed at most once. */
      const consumed = await deps.store.delete(k.code);
      return consumed ? { ok: true } : { ok: false, error: { code: 'expired' } };
    }

    if (attempts >= policy.maxAttempts) {
      await deps.store.delete(k.code);
      return { ok: false, error: { code: 'too_many_attempts' } };
    }
    await deps.store.set(k.code, { ...stored, a: attempts }, stored.x - current);
    return {
      ok: false,
      error: { code: 'invalid', attemptsRemaining: policy.maxAttempts - attempts },
    };
  }

  return { issueCode, verifyCode };
}
