import { REFERRAL_QUERY_PARAM, REFERRAL_STORAGE_KEY } from 'librechat-data-provider';

/** How long a code from an invite link waits for its account to sign up and claim it. */
const STORED_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

interface StoredReferral {
  code: string;
  at: number;
}

/** Keeps the code of an invite link (`?ref=CODE`) until the account it brings claims it. */
export function captureReferralCode(search: string = window.location.search): string | null {
  const code = new URLSearchParams(search).get(REFERRAL_QUERY_PARAM)?.trim().toUpperCase();
  if (!code || !CODE_PATTERN.test(code)) {
    return null;
  }
  try {
    localStorage.setItem(
      REFERRAL_STORAGE_KEY,
      JSON.stringify({ code, at: Date.now() } satisfies StoredReferral),
    );
  } catch {
    /* Storage blocked: the invite simply does not carry over */
  }
  return code;
}

export function getStoredReferralCode(now: number = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as Partial<StoredReferral>;
    if (
      typeof stored.code !== 'string' ||
      !CODE_PATTERN.test(stored.code) ||
      typeof stored.at !== 'number' ||
      now - stored.at > STORED_CODE_TTL_MS
    ) {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return stored.code;
  } catch {
    return null;
  }
}

export function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}
