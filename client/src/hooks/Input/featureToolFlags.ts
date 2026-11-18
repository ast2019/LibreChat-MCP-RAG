import {
  CLIP_TOOL_SKILLS,
  OFFICE_TOOL_SKILLS,
  PERSIAN_TOOL_SKILLS,
} from 'librechat-data-provider';
import type { TEphemeralAgent } from 'librechat-data-provider';

const OFFICE_SKILLS = new Set(Object.values(OFFICE_TOOL_SKILLS).flat());
const CLIP_SKILLS = new Set(Object.values(CLIP_TOOL_SKILLS).flat());
const PERSIAN_SKILLS = new Set(Object.values(PERSIAN_TOOL_SKILLS).flat());

export type FeatureToolPatch = Partial<
  Pick<TEphemeralAgent, 'media' | 'office' | 'clip' | 'persian' | 'ask_user_question' | 'skills'>
>;

/** Feature tool flags implied by staging one deployment skill by name. */
export function flagsForSkillName(name: string): FeatureToolPatch {
  const patch: FeatureToolPatch = { ask_user_question: true, skills: true };
  if (OFFICE_SKILLS.has(name)) {
    patch.office = true;
  }
  if (CLIP_SKILLS.has(name)) {
    patch.clip = true;
  }
  if (PERSIAN_SKILLS.has(name)) {
    patch.persian = true;
  }
  return patch;
}

/**
 * Explicit clears when unstaging a feature skill that no remaining staged skill still needs.
 * Sticky opt-in (`ephemeralAgent.clip` after submit drains the skill chip) must not be wiped by
 * staging an unrelated skill — only by this patch or `features.set({ clip: false })`.
 */
export function clearFlagsForUnstage(
  name: string,
  remainingSkills: readonly string[],
): FeatureToolPatch {
  const patch: FeatureToolPatch = {};
  if (OFFICE_SKILLS.has(name) && !remainingSkills.some((skill) => OFFICE_SKILLS.has(skill))) {
    patch.office = false;
  }
  if (CLIP_SKILLS.has(name) && !remainingSkills.some((skill) => CLIP_SKILLS.has(skill))) {
    patch.clip = false;
  }
  if (PERSIAN_SKILLS.has(name) && !remainingSkills.some((skill) => PERSIAN_SKILLS.has(skill))) {
    patch.persian = false;
  }
  return patch;
}

/**
 * Merge a patch, promote flags from remaining staged skills, and keep sticky office/clip/persian
 * when neither the patch nor remaining skills touch them. Clears `ask_user_question` when no
 * feature tool flag remains.
 */
export function reconcileFeatureFlags(
  agent: TEphemeralAgent | null | undefined,
  remainingSkills: readonly string[],
  patch: FeatureToolPatch = {},
): TEphemeralAgent {
  const next: TEphemeralAgent = { ...(agent ?? {}), ...patch };
  if (remainingSkills.some((skill) => OFFICE_SKILLS.has(skill))) {
    next.office = true;
  } else if (Object.prototype.hasOwnProperty.call(patch, 'office')) {
    next.office = patch.office;
  }
  if (remainingSkills.some((skill) => CLIP_SKILLS.has(skill))) {
    next.clip = true;
  } else if (Object.prototype.hasOwnProperty.call(patch, 'clip')) {
    next.clip = patch.clip;
  }
  if (remainingSkills.some((skill) => PERSIAN_SKILLS.has(skill))) {
    next.persian = true;
  } else if (Object.prototype.hasOwnProperty.call(patch, 'persian')) {
    next.persian = patch.persian;
  }
  const anyFeature =
    next.media === true ||
    next.office === true ||
    next.clip === true ||
    next.persian === true ||
    next.higgsfield === true;
  if (!anyFeature) {
    next.ask_user_question = false;
  }
  return next;
}
