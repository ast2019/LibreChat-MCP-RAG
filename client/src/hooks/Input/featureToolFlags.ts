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
 * Merge a patch, then drop office/clip/persian when no remaining staged skill still needs
 * them (unless the patch set that flag explicitly). Clears `ask_user_question` when no
 * feature tool flag remains.
 */
export function reconcileFeatureFlags(
  agent: TEphemeralAgent | null | undefined,
  remainingSkills: readonly string[],
  patch: FeatureToolPatch = {},
): TEphemeralAgent {
  const next: TEphemeralAgent = { ...(agent ?? {}), ...patch };
  if (!Object.prototype.hasOwnProperty.call(patch, 'office')) {
    next.office = remainingSkills.some((skill) => OFFICE_SKILLS.has(skill));
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'clip')) {
    next.clip = remainingSkills.some((skill) => CLIP_SKILLS.has(skill));
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'persian')) {
    next.persian = remainingSkills.some((skill) => PERSIAN_SKILLS.has(skill));
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
