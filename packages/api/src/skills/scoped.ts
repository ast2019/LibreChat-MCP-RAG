import type { Types } from 'mongoose';
import { getDeploymentSkillByName } from '~/skills/deployment';
import { resolveSkillActive } from '~/agents/skills';

export interface SkillScopeParams {
  accessibleSkillIds: readonly Types.ObjectId[];
  skillStates?: Record<string, boolean>;
  userId?: string;
}

/**
 * The tools a saved agent gets from deployment skills: each tool comes with a skill that declares
 * it, when that skill is in the agent's scope and active for the user. A skill the model picks
 * mid-turn cannot add tools to a built graph, so these load with the agent.
 */
export function getSkillScopedTools<T extends string>(
  toolSkills: Readonly<Record<T, readonly string[]>>,
  { accessibleSkillIds, skillStates, userId }: SkillScopeParams,
): T[] {
  if (accessibleSkillIds.length === 0) {
    return [];
  }
  const scoped = new Set(accessibleSkillIds.map((id) => id.toString()));
  const isOn = (skillName: string): boolean => {
    const skill = getDeploymentSkillByName(skillName);
    return (
      skill != null &&
      scoped.has(skill._id.toString()) &&
      resolveSkillActive({ skill, skillStates, userId })
    );
  };
  const entries = Object.entries(toolSkills) as Array<[T, readonly string[]]>;
  return entries.filter(([, skills]) => skills.some(isOn)).map(([tool]) => tool);
}
