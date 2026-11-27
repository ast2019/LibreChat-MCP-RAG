import { ClipTools, CLIP_TOOL_SKILLS, clipToolsSchema } from 'librechat-data-provider';
import type {
  TClipToolsConfig,
  TClipToolsStartupConfig,
  TModelSpec,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { SkillScopeParams } from '~/skills/scoped';
import { getSkillScopedTools } from '~/skills/scoped';
import { readConfigSection } from '~/app/config';
import { describeClipVoices } from './voices';
import { pexelsKey } from './images';

export function getClipConfig(appConfig: AppConfig | null | undefined): TClipToolsConfig {
  const parsed = clipToolsSchema.safeParse(readConfigSection(appConfig, 'clipTools') ?? {});
  return parsed.success ? parsed.data : clipToolsSchema.parse({});
}

export function getEnabledClipTools(
  config: TClipToolsConfig,
  env: Record<string, string | undefined> = process.env,
): ClipTools[] {
  if (!config.clip || getRemotionServiceTarget(env) == null) {
    return [];
  }
  return [ClipTools.clip];
}

/** Clip tools an ordinary chat may offer once the composer opts in (`ephemeralAgent.clip`). */
export function getChatClipTools(
  appConfig: AppConfig | null | undefined,
  spec?: Pick<TModelSpec, 'privacy'> | null,
  env: Record<string, string | undefined> = process.env,
): ClipTools[] {
  if (spec?.privacy === 'private' || spec?.privacy === 'local') {
    return [];
  }
  return getEnabledClipTools(getClipConfig(appConfig), env);
}

export function getSkillClipTools(
  appConfig: AppConfig | null | undefined,
  params: SkillScopeParams,
  env: Record<string, string | undefined> = process.env,
): ClipTools[] {
  const enabled = new Set(getEnabledClipTools(getClipConfig(appConfig), env));
  return getSkillScopedTools(CLIP_TOOL_SKILLS, params).filter((tool) => enabled.has(tool));
}

/** What the composer needs to offer the «کلیپ‌ساز» row. */
export function getClipStartupConfig(
  appConfig: AppConfig | null | undefined,
  env: Record<string, string | undefined> = process.env,
): TClipToolsStartupConfig {
  return {
    clip: getClipConfig(appConfig).clip && getRemotionServiceTarget(env) != null,
    wizard:
      getClipConfig(appConfig).clip &&
      getClipConfig(appConfig).wizard.enabled &&
      getRemotionServiceTarget(env) != null,
  };
}

export interface RemotionServiceTarget {
  url: string;
  token: string;
}

/** Remotion worker URL + token from the environment (Coolify). */
export function getRemotionServiceTarget(
  env: Record<string, string | undefined> = process.env,
): RemotionServiceTarget | null {
  const url = env.REMOTION_SERVICE_URL?.trim().replace(/\/+$/, '');
  const token = env.REMOTION_SERVICE_TOKEN?.trim();
  if (!url || !/^https?:\/\//.test(url) || !token || token.length < 32) {
    return null;
  }
  return { url, token };
}

export function buildClipToolContext(
  toolNames: readonly string[],
  imageFiles: ReadonlyArray<{ file_id?: string; filename?: string }> | null | undefined,
  audioFiles: ReadonlyArray<{ file_id?: string; filename?: string }> | null | undefined,
  appConfig?: AppConfig | null,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!toolNames.includes(ClipTools.clip)) {
    return {};
  }
  const config = getClipConfig(appConfig);
  const images = (imageFiles ?? []).filter((file): file is { file_id: string; filename?: string } =>
    Boolean(file?.file_id),
  );
  const audios = (audioFiles ?? []).filter((file): file is { file_id: string; filename?: string } =>
    Boolean(file?.file_id),
  );
  const sources = [
    'file (attached, or generated_image_id from this chat)',
    ...(config.aiImages ? [`ai (at most ${config.maxAiImages}, charged like the image tool)`] : []),
    ...(pexelsKey(config.stockImages, env) ? [`stock (Pexels, at most ${config.maxStockImages})`] : []),
  ];
  const parts = [
    `create_remotion_clip renders storyboard motion graphics in the background (up to ${config.maxDurationSec}s, at most ${config.maxScenes} scenes, one clip job per user at a time). Image sources here: ${sources.join(', ')}. Music: ${config.music ? 'ambient, pulse, cinematic' : 'off'}. Brief the user and get the outline approved before rendering. Narration voices for audio.voice (the user may pick one by label; "charged" voices are billed like AI images; omit audio.voice for the default): ${describeClipVoices(config)}.`,
  ];
  if (images.length > 0) {
    parts.push(
      `Images attached to this request:\n${images
        .map((file) => `- ${file.file_id}${file.filename ? ` (${file.filename})` : ''}`)
        .join('\n')}\nUse an id as an image {source:"file",file_id} or as logo_file_id.`,
    );
  }
  if (audios.length > 0) {
    parts.push(
      `Audio attached to this request:\n${audios
        .map((file) => `- ${file.file_id}${file.filename ? ` (${file.filename})` : ''}`)
        .join('\n')}\nFor audio.mode=upload, use an id as audio.file_id.`,
    );
  }
  return { [ClipTools.clip]: parts.join('\n') };
}
