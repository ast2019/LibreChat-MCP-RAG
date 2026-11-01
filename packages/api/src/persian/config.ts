import {
  PERSIAN_TOOL_NAMES,
  PERSIAN_TOOL_SKILLS,
  persianToolsSchema,
} from 'librechat-data-provider';
import type { TModelSpec, TPersianToolsConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { SkillScopeParams } from '~/skills/scoped';
import { getSkillScopedTools } from '~/skills/scoped';
import { readConfigSection } from '~/app/config';

/** The deployment's Persian tools settings; the defaults when the section is absent or invalid. */
export function getPersianConfig(appConfig: AppConfig | null | undefined): TPersianToolsConfig {
  const parsed = persianToolsSchema.safeParse(readConfigSection(appConfig, 'persianTools') ?? {});
  return parsed.success ? parsed.data : persianToolsSchema.parse({});
}

/**
 * The Persian tools an ordinary chat offers. A confidential or local spec keeps the tool set the
 * operator chose for it, the same rule the media tools follow.
 */
export function getChatPersianTools(
  appConfig: AppConfig | null | undefined,
  spec?: Pick<TModelSpec, 'privacy'> | null,
): string[] {
  if (spec?.privacy === 'private' || spec?.privacy === 'local') {
    return [];
  }
  return getPersianConfig(appConfig).chat ? [...PERSIAN_TOOL_NAMES] : [];
}

/**
 * The Persian tools a saved agent gets from its skills: each tool comes with the deployment skill
 * that declares it, when that skill is in the agent's scope and active for the user. Loaded with
 * the agent so a skill the model picks mid-turn finds its tool.
 */
export function getSkillPersianTools(params: SkillScopeParams): string[] {
  return getSkillScopedTools(PERSIAN_TOOL_SKILLS, params);
}
