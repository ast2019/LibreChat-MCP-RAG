import { z } from 'zod';

/** Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits mapped to ASCII. */
const NON_ASCII_DIGITS = /[\u06F0-\u06F9\u0660-\u0669]/g;
/** Separators people paste or type inside numbers: spaces, dashes, dots, parentheses, NBSP, ZWNJ. */
const SEPARATORS = /[\s\-().\u00A0\u200C\u200F\u200E]/g;
/** Iranian mobile ranges all start with 9 after the country code (`+98 9xx xxx xxxx`). */
const IRAN_MOBILE = /^\+989\d{9}$/;

/** Converts Persian/Arabic digits to ASCII; other characters are kept. */
export function toAsciiDigits(value: string): string {
  return value.replace(NON_ASCII_DIGITS, (char) => {
    const code = char.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Normalizes an Iranian mobile number to E.164 (`+989121234567`). Accepts `09121234567`,
 * `9121234567`, `+989121234567`, `00989121234567` and `989121234567`, with Persian or Arabic
 * digits and common separators. Returns `null` for anything that is not an Iranian mobile.
 */
export function normalizeIranianMobile(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  let value = toAsciiDigits(input.trim()).replace(SEPARATORS, '');
  if (value.length === 0 || value.length > 20) {
    return null;
  }
  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`;
  }
  if (value.startsWith('+')) {
    return IRAN_MOBILE.test(value) ? value : null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  if (value.startsWith('98') && value.length === 12) {
    value = value.slice(2);
  } else if (value.startsWith('0') && value.length === 11) {
    value = value.slice(1);
  }
  const e164 = `+98${value}`;
  return IRAN_MOBILE.test(e164) ? e164 : null;
}

/** National format (`09121234567`) for an E.164 Iranian mobile, as SMS gateways expect it. */
export function toIranianNationalMobile(e164: string): string {
  return e164.startsWith('+98') ? `0${e164.slice(3)}` : e164;
}

/** Masks a number for display or logs: `+98912***4567`. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) {
    return '***';
  }
  return `${e164.slice(0, 6)}***${e164.slice(-4)}`;
}

/** Purposes a one-time phone code can be issued for; a code only verifies for its own purpose. */
export const PHONE_OTP_PURPOSES = ['login', 'link'] as const;
export type PhoneOtpPurpose = (typeof PHONE_OTP_PURPOSES)[number];

/**
 * Stable error codes returned by the phone auth routes (`{ code }`); the client maps them to
 * localized copy. Codes never reveal whether a number is registered.
 */
export enum PhoneAuthErrorCode {
  DISABLED = 'phone_login_disabled',
  INVALID_PHONE = 'phone_invalid',
  INVALID_CODE = 'phone_code_invalid',
  EXPIRED = 'phone_code_expired',
  TOO_MANY_ATTEMPTS = 'phone_code_attempts',
  COOLDOWN = 'phone_code_cooldown',
  RATE_LIMITED = 'phone_rate_limited',
  SEND_FAILED = 'phone_send_failed',
  REGISTRATION_CLOSED = 'phone_registration_closed',
  PHONE_IN_USE = 'phone_in_use',
  ACCOUNT_UNAVAILABLE = 'phone_account_unavailable',
  /** Removing the number would leave the account without an identifier. */
  ONLY_IDENTIFIER = 'phone_only_identifier',
  NAME_INVALID = 'name_invalid',
  /** Step-up password missing or wrong. */
  PASSWORD_INVALID = 'phone_password_invalid',
}

export type TPhoneCodeRequest = {
  phone: string;
  purpose?: PhoneOtpPurpose;
  turnstileToken?: string;
};

/** Always the same shape for a valid number, registered or not. */
export type TPhoneCodeRequestResponse = {
  sent: true;
  /** Seconds until another code may be requested. */
  cooldownSeconds: number;
  /** Seconds the code stays valid. */
  expiresInSeconds: number;
  codeLength: number;
};

export type TPhoneCodeVerify = {
  phone: string;
  code: string;
  /** Optional display name for an account created by this verification. */
  name?: string;
};

export type TPhoneAuthError = {
  code: PhoneAuthErrorCode;
  /** Seconds to wait, for cooldown and rate-limit codes. */
  retryAfterSeconds?: number;
};

/**
 * `registration.phone` in librechat.yaml. Absent or `enabled: false` keeps phone sign-in off.
 * `allowRegistration` unset follows `ALLOW_REGISTRATION`, like email registration.
 */
export const phoneLoginConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['kavenegar']).default('kavenegar'),
  /** Kavenegar Verify Lookup template name; without one, codes go through `sms/send` + `sender`. */
  template: z.string().min(1).max(100).optional(),
  /** Sender line for the `sms/send` fallback. */
  sender: z.string().min(1).max(30).optional(),
  codeTtlSeconds: z.number().int().min(30).max(900).default(120),
  resendCooldownSeconds: z.number().int().min(10).max(600).default(60),
  maxAttempts: z.number().int().min(1).max(10).default(5),
  /** Code requests one number may receive per rolling hour. */
  maxRequestsPerPhonePerHour: z.number().int().min(1).max(100).default(5),
  /** Code requests one IP may make per rolling hour. */
  maxRequestsPerIpPerHour: z.number().int().min(1).max(1000).default(20),
  /** Whether verifying an unknown number creates an account; unset follows `ALLOW_REGISTRATION`. */
  allowRegistration: z.boolean().optional(),
});

export type TPhoneLoginConfig = z.infer<typeof phoneLoginConfigSchema>;
