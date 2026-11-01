import { OfficeTools, OFFICE_TOOL_SKILLS, officeToolsSchema } from 'librechat-data-provider';
import type {
  TModelSpec,
  TOfficeToolsConfig,
  TOfficeToolsStartupConfig,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { SkillScopeParams } from '~/skills/scoped';
import { getSkillScopedTools } from '~/skills/scoped';
import { readConfigSection } from '~/app/config';

/** The deployment's `officeTools` settings; the defaults when the section is absent or invalid. */
export function getOfficeConfig(appConfig: AppConfig | null | undefined): TOfficeToolsConfig {
  const parsed = officeToolsSchema.safeParse(readConfigSection(appConfig, 'officeTools') ?? {});
  return parsed.success ? parsed.data : officeToolsSchema.parse({});
}

/** The Office tools the deployment has on, in a stable order. */
export function getEnabledOfficeTools(config: TOfficeToolsConfig): OfficeTools[] {
  const tools: OfficeTools[] = [];
  if (config.word) {
    tools.push(OfficeTools.word);
  }
  if (config.slides) {
    tools.push(OfficeTools.slides);
  }
  return tools;
}

/**
 * The Office tools an ordinary chat offers. A confidential or local spec keeps the tool set the
 * operator chose for it, the rule the media and Persian tools follow.
 */
export function getChatOfficeTools(
  appConfig: AppConfig | null | undefined,
  spec?: Pick<TModelSpec, 'privacy'> | null,
): OfficeTools[] {
  if (spec?.privacy === 'private' || spec?.privacy === 'local') {
    return [];
  }
  return getEnabledOfficeTools(getOfficeConfig(appConfig));
}

/** The Office tools a saved agent gets with the article and slide skills in its scope. */
export function getSkillOfficeTools(
  appConfig: AppConfig | null | undefined,
  params: SkillScopeParams,
): OfficeTools[] {
  const enabled = new Set(getEnabledOfficeTools(getOfficeConfig(appConfig)));
  return getSkillScopedTools(OFFICE_TOOL_SKILLS, params).filter((tool) => enabled.has(tool));
}

/** What the composer needs to offer the «ساختن» rows of the article wizard and the slide builder. */
export function getOfficeStartupConfig(
  appConfig: AppConfig | null | undefined,
): TOfficeToolsStartupConfig {
  const config = getOfficeConfig(appConfig);
  return { word: config.word, slides: config.slides };
}

/**
 * Tells the Office tools which images came with this request, by id, so a logo or a picture the
 * user attached can go into the file. Images from earlier messages are not listed.
 */
export function buildOfficeToolContext(
  toolNames: readonly string[],
  imageFiles: ReadonlyArray<{ file_id?: string; filename?: string }> | null | undefined,
): Record<string, string> {
  const files = (imageFiles ?? []).filter((file): file is { file_id: string; filename?: string } =>
    Boolean(file?.file_id),
  );
  if (files.length === 0) {
    return {};
  }
  const lines = files.map(
    (file) => `- ${file.file_id}${file.filename ? ` (${file.filename})` : ''}`,
  );
  const listing = `Images the user attached to this request, by id, in order:\n${lines.join('\n')}`;
  const context: Record<string, string> = {};
  if (toolNames.includes(OfficeTools.word)) {
    context[OfficeTools.word] =
      `${listing}\nUse an id as \`logo_image_id\`, or in the Markdown as ![caption](image:<id>).`;
  }
  if (toolNames.includes(OfficeTools.slides)) {
    context[OfficeTools.slides] =
      `${listing}\nUse an id as \`logo_image_id\` or as a slide's \`image_id\`.`;
  }
  return context;
}
