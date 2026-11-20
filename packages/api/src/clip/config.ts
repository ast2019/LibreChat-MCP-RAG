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
import { STYLE_FILM_3D_MAX_SEC, STYLE_FILM_MAX_SEC } from './styleFilms';

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
): Record<string, string> {
  if (!toolNames.includes(ClipTools.clip)) {
    return {};
  }
  const images = (imageFiles ?? []).filter((file): file is { file_id: string; filename?: string } =>
    Boolean(file?.file_id),
  );
  const audios = (audioFiles ?? []).filter((file): file is { file_id: string; filename?: string } =>
    Boolean(file?.file_id),
  );
  const parts = [
    `Build short MP4s with create_remotion_clip. brand-dark/light/ugc = text slides (≤30s). Other themes = catalog style films (1080×1350, the 5s animation loops to the requested length, up to ${STYLE_FILM_MAX_SEC}s; brick-toy and claymation up to ${STYLE_FILM_3D_MAX_SEC}s) from the vendored animation-styles pack (only looks that have a real film). Ask before rendering.`,
  ];
  if (images.length > 0) {
    parts.push(
      `Images attached to this request:\n${images
        .map((file) => `- ${file.file_id}${file.filename ? ` (${file.filename})` : ''}`)
        .join('\n')}\nUse an id as logo_file_id.`,
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
