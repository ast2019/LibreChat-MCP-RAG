import { logger } from '@librechat/data-schemas';
import { resolveTimePackRuntime } from 'librechat-data-provider';
import type { TimePackEntitlement, TTimePackRuntime } from 'librechat-data-provider';
import type { TimePackRequestAdmission } from './admitTimePack';

/**
 * A ClaudeTime gateway can answer a turn with an empty completion (seen: ~30 s, 5 completion
 * tokens). With `balance.timePack.emptyRetry` the turn runs once more. The seat is released
 * before the second attempt and taken again (which also charges the shared request rate), and
 * only the second attempt's usage is metered, so a retried turn is metered once.
 */

type ContentPart = { type?: string; text?: unknown } | null | undefined;

function visibleText(part: ContentPart): string {
  const text = part?.text;
  if (typeof text === 'string') {
    return text;
  }
  const value = (text as { value?: unknown } | null | undefined)?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Whether a finished attempt produced nothing the user can read: only text and thinking parts,
 * with fewer than `minChars` visible (trimmed) characters. A tool call, an error or any other
 * part means the attempt did something, so it is never retried.
 */
export function isEmptyCompletion(
  contentParts: readonly ContentPart[] | null | undefined,
  minChars: number,
): boolean {
  let visible = 0;
  for (const part of contentParts ?? []) {
    if (part == null) {
      continue;
    }
    if (part.type === 'text') {
      visible += visibleText(part).trim().length;
    } else if (part.type !== 'think') {
      return false;
    }
  }
  return visible < minChars;
}

/**
 * After the seat is released and not taken again: admission cleared the entitlement, but the
 * first attempt's reply still ends under it, and the final slot release must not decrement a
 * pending-request counter this time-pack turn never incremented.
 */
function keepWithoutSeat(req: EmptyRetryRequest, entitlement: TimePackEntitlement): void {
  req._timePackEntitlement = entitlement;
  req._scheduleConcurrencyExempt = true;
}

export type EmptyRetryOutcome = {
  /** Whether a second attempt ran. */
  retried: boolean;
  /** Why no retry ran, when the first attempt was empty and `retried` is false. */
  skipped?: 'seat_unavailable';
};

export type EmptyRetryRequest = {
  _timePackEntitlement?: TimePackEntitlement | null;
  /** Makes the final slot release a no-op (see `releaseAdmittedRequestSlot`). */
  _scheduleConcurrencyExempt?: boolean;
};

/**
 * Runs `attempt(false)`, then `attempt(true)` once when the first came back empty on a time-pack
 * turn. Errors of an attempt propagate untouched and are never retried.
 */
export async function runWithEmptyRetry({
  req,
  timePack,
  attempt,
  getContentParts,
  canRetry,
  resetAttempt,
  releaseSeat,
  reacquireSeat,
}: {
  req: EmptyRetryRequest;
  timePack?: Partial<TTimePackRuntime> | null;
  attempt: (isRetry: boolean) => Promise<void>;
  getContentParts: () => readonly ContentPart[];
  /** False when the turn was aborted or paused, so a second run would be wrong. */
  canRetry: () => boolean;
  /** Drops the first attempt's content and usage so the second is the one that is metered. */
  resetAttempt: () => void;
  releaseSeat: () => Promise<void>;
  reacquireSeat: () => Promise<TimePackRequestAdmission>;
}): Promise<EmptyRetryOutcome> {
  await attempt(false);
  const { emptyRetry, emptyRetryMinChars } = resolveTimePackRuntime(timePack);
  const entitlement = req._timePackEntitlement;
  if (
    !emptyRetry ||
    entitlement == null ||
    !canRetry() ||
    !isEmptyCompletion(getContentParts(), emptyRetryMinChars)
  ) {
    return { retried: false };
  }
  logger.warn('[timePack] empty completion; releasing the seat and retrying once', {
    timePackId: entitlement.timePackId,
    endpoint: entitlement.timePackEndpoint,
  });
  await releaseSeat();
  let admission: TimePackRequestAdmission;
  try {
    admission = await reacquireSeat();
  } catch (error) {
    keepWithoutSeat(req, entitlement);
    throw error;
  }
  if (admission.kind !== 'admitted') {
    keepWithoutSeat(req, entitlement);
    logger.warn('[timePack] empty-completion retry skipped: seat not available', {
      kind: admission.kind,
    });
    return { retried: false, skipped: 'seat_unavailable' };
  }
  resetAttempt();
  await attempt(true);
  return { retried: true };
}
