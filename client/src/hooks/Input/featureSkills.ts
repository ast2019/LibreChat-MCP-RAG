import { OfficeTools, OFFICE_TOOL_SKILLS } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';

/**
 * The name the user sees for a feature's own skill: the «ساختن» row's label. The skill lists
 * leave these skills out, so the staged chip must not show the raw name (`article-writer`).
 */
export const FEATURE_SKILL_LABELS: Readonly<Record<string, TranslationKeys>> = {
  [OFFICE_TOOL_SKILLS[OfficeTools.word][0]]: 'com_ui_create_article',
  [OFFICE_TOOL_SKILLS[OfficeTools.slides][0]]: 'com_ui_create_slides',
};
