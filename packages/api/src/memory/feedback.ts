import { logger } from '@librechat/data-schemas';
import {
  Permissions,
  PermissionTypes,
  appendMemoryLine,
  dedupeMemoryLines,
  hasActivePiiPatterns,
  PREFERENCE_MEMORY_KEY,
} from 'librechat-data-provider';
import type { IUser, MemoryMethods } from '@librechat/data-schemas';
import type {
  FiltersConfig,
  TMemoryConfig,
  TMinimalFeedback,
  TFeedbackMemoryOutcome,
} from 'librechat-data-provider';
import type { Request } from 'express';
import type { CheckAccessParams } from '../middleware/access';
import { isMemoryEnabled, isMemoryExcludedForEndpoint } from './config';
import { extractMemoryContent } from '../protection/adapters/submissions';
import { inspectContent } from '../protection/runtime';
import { checkAccess } from '../middleware/access';
import { getSafeErrorMetadata } from '../utils/errors';

export type FeedbackMemoryOutcome = TFeedbackMemoryOutcome;

export interface FeedbackMemoryDeps extends Pick<MemoryMethods, 'getUserMemories' | 'setMemory'> {
  getRoleByName: CheckAccessParams['getRoleByName'];
  countTokens: (value: string) => number;
}

export interface FeedbackMemoryParams {
  req?: Request;
  user: IUser;
  config: { memory?: TMemoryConfig; filters?: FiltersConfig } | undefined;
  feedback: TMinimalFeedback | null | undefined;
  /** Endpoint of the rated answer; feedback on an excluded endpoint's answer is never learned. */
  endpoint?: string | null;
}

/** Longest reason kept, in characters; the feedback schema allows 1024. */
const MAX_REASON_LENGTH = 500;

/**
 * The memory line for a feedback reason: the rating and tag (stable, language-neutral keys the
 * model reads), then the user's own words on one line.
 */
export function formatFeedbackLine(feedback: TMinimalFeedback): string | null {
  const reason = feedback.text?.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);
  if (!reason) {
    return null;
  }
  const verdict = feedback.rating === 'thumbsDown' ? 'Disliked' : 'Liked';
  return `- ${verdict} (${feedback.tag}): ${reason}`;
}

/**
 * Adds a feedback reason to the user's shared `preferences` memory when
 * `memory.learnFromFeedback` is on. Expected refusals return an outcome; a database failure
 * throws, for the route to log without failing the saved feedback.
 */
export async function learnFromFeedback(
  deps: FeedbackMemoryDeps,
  { req, user, config, feedback, endpoint }: FeedbackMemoryParams,
): Promise<FeedbackMemoryOutcome> {
  const memoryConfig = config?.memory;
  if (!feedback || memoryConfig?.learnFromFeedback !== true || !isMemoryEnabled(memoryConfig)) {
    return 'skipped';
  }
  const line = formatFeedbackLine(feedback);
  if (!line || user.personalization?.memories === false) {
    return 'skipped';
  }
  if (isMemoryExcludedForEndpoint(memoryConfig, endpoint)) {
    return 'skipped';
  }
  const validKeys = memoryConfig.validKeys;
  if (
    Array.isArray(validKeys) &&
    validKeys.length > 0 &&
    !validKeys.includes(PREFERENCE_MEMORY_KEY)
  ) {
    return 'skipped';
  }

  let allowed = false;
  try {
    allowed = await checkAccess({
      req,
      user,
      permissionType: PermissionTypes.MEMORIES,
      permissions: [Permissions.USE, Permissions.CREATE, Permissions.UPDATE],
      getRoleByName: deps.getRoleByName,
    });
  } catch (error) {
    logger.error('[memory] Feedback permission check failed', getSafeErrorMetadata(error));
  }
  if (!allowed) {
    return 'skipped';
  }

  /** The same check a memory saved by hand gets (`blockFilteredMemoryContent`) */
  const filters = config?.filters;
  if (
    hasActivePiiPatterns(filters?.memories?.pii) &&
    inspectContent(extractMemoryContent({ key: PREFERENCE_MEMORY_KEY, value: line }), { filters })
  ) {
    return 'skipped';
  }

  const userId = String(user.id ?? user._id);
  const memories = await deps.getUserMemories({ userId });
  const existing = memories.find((memory) => memory.key === PREFERENCE_MEMORY_KEY);
  const current = existing ? dedupeMemoryLines(existing.value) : '';
  const value = appendMemoryLine(existing?.value, line);
  if (value === current) {
    return 'duplicate';
  }

  const charLimit = memoryConfig.charLimit ?? 10000;
  if (value.length > charLimit) {
    return 'full';
  }
  const tokenCount = deps.countTokens(value);
  const tokenLimit = memoryConfig.tokenLimit;
  if (tokenLimit) {
    const others = memories.reduce(
      (sum, memory) =>
        memory.key === PREFERENCE_MEMORY_KEY ? sum : sum + (memory.tokenCount ?? 0),
      0,
    );
    if (others + tokenCount > tokenLimit) {
      return 'full';
    }
  }

  const result = await deps.setMemory({ userId, key: PREFERENCE_MEMORY_KEY, value, tokenCount });
  return result.ok ? 'saved' : 'skipped';
}
