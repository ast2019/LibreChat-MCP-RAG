import type { TBalancePack } from 'librechat-data-provider';

/** Upper bound for one grant: $100,000 of usage, a guard against a mistyped amount. */
export const MAX_GRANT_CREDITS = 100_000_000_000;

export type BalanceGrantErrorCode =
  | 'grant_target_required'
  | 'grant_amount_required'
  | 'grant_amount_ambiguous'
  | 'grant_amount_invalid'
  | 'pack_not_found';

export type BalanceGrantResolution =
  | { ok: true; value: { credits: number; pack?: TBalancePack } }
  | { ok: false; error: { code: BalanceGrantErrorCode; message: string } };

export interface BalanceGrantRequest {
  packId?: unknown;
  credits?: unknown;
}

/**
 * Turns an admin grant request into a credit amount: either a configured pack (by id)
 * or a raw positive whole number of credits, never both.
 */
export function resolveBalanceGrant(
  packs: readonly TBalancePack[] | undefined,
  { packId, credits }: BalanceGrantRequest,
): BalanceGrantResolution {
  const hasPack = packId != null && packId !== '';
  const hasCredits = credits != null && credits !== '';
  if (hasPack && hasCredits) {
    return {
      ok: false,
      error: { code: 'grant_amount_ambiguous', message: 'Send either packId or credits, not both' },
    };
  }
  if (hasPack) {
    const pack = typeof packId === 'string' ? packs?.find((p) => p.id === packId) : undefined;
    if (!pack) {
      return {
        ok: false,
        error: { code: 'pack_not_found', message: 'No configured pack has that id' },
      };
    }
    return { ok: true, value: { credits: pack.credits, pack } };
  }
  if (hasCredits) {
    if (
      typeof credits !== 'number' ||
      !Number.isInteger(credits) ||
      credits <= 0 ||
      credits > MAX_GRANT_CREDITS
    ) {
      return {
        ok: false,
        error: {
          code: 'grant_amount_invalid',
          message: `credits must be a whole number between 1 and ${MAX_GRANT_CREDITS}`,
        },
      };
    }
    return { ok: true, value: { credits } };
  }
  return {
    ok: false,
    error: { code: 'grant_amount_required', message: 'Send packId or credits' },
  };
}

export interface GrantBalanceDeps {
  /** Records the ledger entry and applies it to the balance; resolves the new balance. */
  createTransaction: (txData: {
    user: string;
    tokenType: 'credits';
    context: string;
    rawAmount: number;
    balance: { enabled: boolean };
  }) => Promise<{ balance: number } | undefined>;
  upsertBalanceFields: (
    user: string,
    fields: {
      packId?: string;
      packLabel?: string;
      packAllotment?: number;
      packGrantedAt?: Date;
    },
  ) => Promise<unknown>;
  now?: () => Date;
}

export interface GrantBalanceResult {
  balance: number;
  credits: number;
  packAllotment: number;
  pack: { id: string; label: string } | null;
}

/** Ledger context of a grant, so pack sales and manual top-ups stay separable in reports. */
export const PACK_GRANT_CONTEXT = 'pack';
export const MANUAL_GRANT_CONTEXT = 'admin';

/**
 * Adds credits to a user's balance through the audited transaction ledger, then records
 * the grant as the user's current allotment. The usage bar measures spend against that
 * allotment, so after any top-up it starts again from "0% used". Leftover credits carry
 * over and are part of the new allotment.
 *
 * Throws when the ledger write did not happen (for example `transactions.enabled: false`),
 * because silently reporting success would hide credits that were never added.
 */
export async function grantBalance(
  deps: GrantBalanceDeps,
  { userId, credits, pack }: { userId: string; credits: number; pack?: TBalancePack },
): Promise<GrantBalanceResult> {
  const result = await deps.createTransaction({
    user: userId,
    tokenType: 'credits',
    context: pack ? PACK_GRANT_CONTEXT : MANUAL_GRANT_CONTEXT,
    rawAmount: credits,
    balance: { enabled: true },
  });
  if (result == null || typeof result.balance !== 'number') {
    throw new Error('Balance grant was not recorded; check that transactions are enabled');
  }

  const packAllotment = result.balance;
  await deps.upsertBalanceFields(userId, {
    packId: pack?.id ?? 'custom',
    packLabel: pack?.label ?? '',
    packAllotment,
    packGrantedAt: (deps.now ?? (() => new Date()))(),
  });

  return {
    balance: result.balance,
    credits,
    packAllotment,
    pack: pack ? { id: pack.id, label: pack.label } : null,
  };
}
