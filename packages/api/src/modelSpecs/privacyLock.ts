import type { TModelSpec } from 'librechat-data-provider';

export type SpecPrivacyLockReason =
  | 'private_locked'
  | 'private_requires_new_chat'
  | 'private_no_compare';

export type SpecPrivacyLockResult =
  | { allowed: true }
  | { allowed: false; reason: SpecPrivacyLockReason };

export type CheckSpecPrivacyLockParams = {
  /** Spec persisted on the conversation (`null`/absent when it never had one). */
  storedSpec?: string | null;
  /** Spec the request asks to run with. */
  requestedSpec?: string | null;
  /** Configured model specs, including ones hidden from the menu. */
  list?: Pick<TModelSpec, 'name' | 'privacy'>[] | null;
  /** The conversation already holds messages (a persisted conversation counts as such). */
  hasMessages: boolean;
  /**
   * Spec of a second, side-by-side ("compare") conversation sent with the turn.
   * `undefined` means the turn carries no added conversation.
   */
  addedSpec?: string | null;
};

/** Error text sent to the client for each refusal; kept stable for logs and tests. */
export const SPEC_PRIVACY_LOCK_MESSAGES: Readonly<Record<SpecPrivacyLockReason, string>> = {
  private_locked: 'Model spec locked: private conversation',
  private_requires_new_chat: 'Private model spec requires a new conversation',
  private_no_compare: 'Model comparison is not allowed in a private conversation',
};

const ALLOWED: SpecPrivacyLockResult = { allowed: true };

function isPrivateSpec(
  list: Pick<TModelSpec, 'name' | 'privacy'>[],
  spec: string | null | undefined,
): boolean {
  if (!spec) {
    return false;
  }
  return list.some((modelSpec) => modelSpec?.name === spec && modelSpec.privacy === 'private');
}

/**
 * Data-safety rule for confidential (`privacy: 'private'`) model specs:
 * - a private conversation with history can never change spec (R1);
 * - a non-private conversation with history cannot become private in place,
 *   which would carry non-confidential history into a confidential chat (R2);
 * - a private turn cannot fan out to a second model with another spec.
 * Local and normal specs, and empty conversations, are unrestricted.
 * Does nothing when no spec list is configured.
 */
export function checkSpecPrivacyLock({
  storedSpec,
  requestedSpec,
  list,
  hasMessages,
  addedSpec,
}: CheckSpecPrivacyLockParams): SpecPrivacyLockResult {
  if (!Array.isArray(list) || list.length === 0) {
    return ALLOWED;
  }

  const stored = hasMessages ? (storedSpec ?? null) : null;
  const requested = requestedSpec ?? null;
  const storedIsPrivate = hasMessages && isPrivateSpec(list, stored);
  const requestedIsPrivate = isPrivateSpec(list, requested);

  if (hasMessages && stored !== requested) {
    if (storedIsPrivate) {
      return { allowed: false, reason: 'private_locked' };
    }
    if (requestedIsPrivate) {
      return { allowed: false, reason: 'private_requires_new_chat' };
    }
  }

  if (addedSpec !== undefined && (storedIsPrivate || requestedIsPrivate)) {
    if ((addedSpec ?? null) !== requested) {
      return { allowed: false, reason: 'private_no_compare' };
    }
  }

  return ALLOWED;
}
