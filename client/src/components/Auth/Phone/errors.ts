import axios from 'axios';
import { PhoneAuthErrorCode } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

const errorKeys: Record<PhoneAuthErrorCode, TranslationKeys> = {
  [PhoneAuthErrorCode.DISABLED]: 'com_auth_phone_error_disabled',
  [PhoneAuthErrorCode.INVALID_PHONE]: 'com_auth_phone_error_invalid',
  [PhoneAuthErrorCode.INVALID_CODE]: 'com_auth_phone_error_code_invalid',
  [PhoneAuthErrorCode.EXPIRED]: 'com_auth_phone_error_code_expired',
  [PhoneAuthErrorCode.TOO_MANY_ATTEMPTS]: 'com_auth_phone_error_attempts',
  [PhoneAuthErrorCode.COOLDOWN]: 'com_auth_phone_error_cooldown',
  [PhoneAuthErrorCode.RATE_LIMITED]: 'com_auth_phone_error_rate_limited',
  [PhoneAuthErrorCode.SEND_FAILED]: 'com_auth_phone_error_send_failed',
  [PhoneAuthErrorCode.REGISTRATION_CLOSED]: 'com_auth_phone_error_registration_closed',
  [PhoneAuthErrorCode.PHONE_IN_USE]: 'com_auth_phone_error_in_use',
  [PhoneAuthErrorCode.ACCOUNT_UNAVAILABLE]: 'com_auth_phone_error_unavailable',
  [PhoneAuthErrorCode.ONLY_IDENTIFIER]: 'com_auth_phone_error_only_identifier',
  [PhoneAuthErrorCode.NAME_INVALID]: 'com_auth_phone_error_generic',
  [PhoneAuthErrorCode.PASSWORD_INVALID]: 'com_ui_email_change_error_password',
};

export interface PhoneError {
  key: TranslationKeys;
  code?: PhoneAuthErrorCode;
  /** Interpolated as `{{0}}`: seconds to wait or tries left. */
  value?: number;
  retryAfterSeconds?: number;
}

const isPhoneCode = (code: unknown): code is PhoneAuthErrorCode =>
  typeof code === 'string' && Object.hasOwn(errorKeys, code);

/** Maps a failed phone request to localized copy; unknown failures get the generic message. */
export function readPhoneError(error: unknown): PhoneError {
  if (!axios.isAxiosError(error)) {
    return { key: 'com_auth_phone_error_generic' };
  }
  const data = (error.response?.data ?? {}) as {
    code?: unknown;
    retryAfterSeconds?: unknown;
    attemptsRemaining?: unknown;
  };
  if (!isPhoneCode(data.code)) {
    return { key: 'com_auth_phone_error_generic' };
  }
  const retryAfterSeconds =
    typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined;
  const attemptsRemaining =
    typeof data.attemptsRemaining === 'number' ? data.attemptsRemaining : undefined;
  return {
    key: errorKeys[data.code],
    code: data.code,
    value: data.code === PhoneAuthErrorCode.INVALID_CODE ? attemptsRemaining : retryAfterSeconds,
    retryAfterSeconds,
  };
}
