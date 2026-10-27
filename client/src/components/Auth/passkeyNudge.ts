/** Per-user so a shared browser still offers the nudge to the next person who signs in. */
export const passkeyNudgeStorageKey = (userId: string): string =>
  `hivegpt:passkeyNudgeDismissed:${userId}`;

export function isPasskeyNudgeDismissed(userId: string | undefined): boolean {
  if (!userId) {
    return false;
  }
  try {
    return window.localStorage.getItem(passkeyNudgeStorageKey(userId)) === '1';
  } catch {
    /** Storage blocked (private mode, policy): treat as not dismissed for this session only. */
    return false;
  }
}

export function dismissPasskeyNudge(userId: string | undefined): void {
  if (!userId) {
    return;
  }
  try {
    window.localStorage.setItem(passkeyNudgeStorageKey(userId), '1');
  } catch {
    /* the in-memory dismissal still hides it until reload */
  }
}

export type PasskeyNudgeEligibility = {
  passkeyLoginEnabled: boolean | undefined;
  /** `passkeysSupported()` — WebAuthn exists only on HTTPS or localhost. */
  supported: boolean;
  userId: string | undefined;
  /** Only password accounts can enroll; the server refuses identity-provider accounts. */
  provider: string | undefined;
  dismissed: boolean;
};

/** Whether the user could act on the nudge at all, i.e. whether the passkey list is worth fetching. */
export const canOfferPasskeyNudge = ({
  passkeyLoginEnabled,
  supported,
  userId,
  provider,
  dismissed,
}: PasskeyNudgeEligibility): boolean =>
  passkeyLoginEnabled === true && supported && !!userId && provider === 'local' && !dismissed;

/**
 * The nudge shows only once the list has loaded and is empty: `undefined` covers both
 * loading and a failed fetch, where offering enrollment could duplicate an existing key.
 */
export const shouldShowPasskeyNudge = (
  eligibility: PasskeyNudgeEligibility,
  passkeyCount: number | undefined,
): boolean => canOfferPasskeyNudge(eligibility) && passkeyCount === 0;
