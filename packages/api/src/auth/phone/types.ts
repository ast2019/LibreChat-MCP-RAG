/** Result of handing a code to an SMS gateway; `code` is a provider-specific stable identifier. */
export type SmsSendResult = { ok: true } | { ok: false; error: { code: string; status?: number } };

/** Provider-neutral SMS gateway: a second provider is a new implementation, not a new branch. */
export interface SmsProvider {
  sendCode(input: { phone: string; code: string }): Promise<SmsSendResult>;
}

/** Key-value store with per-entry TTL (Keyv satisfies it). */
export interface OtpStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<unknown>;
  delete(key: string): Promise<boolean>;
}

/** The phone-login levers resolved from `registration.phone`. */
export interface PhoneOtpPolicy {
  codeTtlSeconds: number;
  resendCooldownSeconds: number;
  maxAttempts: number;
}
