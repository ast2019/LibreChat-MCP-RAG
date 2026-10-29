import {
  MediaTools,
  SystemRoles,
  extractEnvVariable,
  mediaGenerationSchema,
} from 'librechat-data-provider';
import type { TMediaGenerationConfig, TModelSpec } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { resolveSpeechEndpoint } from '~/speech/config';
import type { MediaEndpoint, MediaUser } from './types';

const envVarPattern = /^\$\{.+\}$/;

/** The deployment's `mediaGeneration` settings, or null when off or invalid. Secrets are read
 *  from the environment; a Higgsfield block whose keys do not resolve is dropped. */
export function getMediaConfig(appConfig?: AppConfig | null): TMediaGenerationConfig | null {
  const raw = (appConfig?.config as { mediaGeneration?: unknown } | undefined)?.mediaGeneration;
  if (raw == null) {
    return null;
  }
  const parsed = mediaGenerationSchema.safeParse(raw);
  if (!parsed.success || parsed.data.enabled !== true) {
    return null;
  }
  const config = parsed.data;
  if (config.higgsfield) {
    const apiKeyId = extractEnvVariable(config.higgsfield.apiKeyId);
    const apiKeySecret = extractEnvVariable(config.higgsfield.apiKeySecret);
    const unresolved = (value: string) => !value || envVarPattern.test(value);
    config.higgsfield =
      unresolved(apiKeyId) || unresolved(apiKeySecret)
        ? undefined
        : { ...config.higgsfield, apiKeyId, apiKeySecret };
  }
  return config;
}

/** The media tools the deployment has configured, in a stable order. */
export function getConfiguredMediaTools(config: TMediaGenerationConfig | null): MediaTools[] {
  if (!config) {
    return [];
  }
  const tools: MediaTools[] = [];
  if (config.image) {
    tools.push(MediaTools.image);
  }
  if (config.video) {
    tools.push(MediaTools.video);
  }
  if (config.speech) {
    tools.push(MediaTools.speech);
  }
  if (config.higgsfield) {
    tools.push(MediaTools.higgsfield);
  }
  return tools;
}

/**
 * The media tools a chat on this spec offers this user. Confidential and local specs promise
 * the chat reaches no third party, so they get none; a user an admin switched off gets none. The
 * paid-pack rule is checked when a tool runs, so the model can tell the user how to unlock it.
 */
export function getChatMediaTools(
  appConfig: AppConfig | null | undefined,
  user: { mediaAccess?: boolean | null } | null | undefined,
  spec?: Pick<TModelSpec, 'privacy'> | null,
): MediaTools[] {
  const contained = spec?.privacy === 'private' || spec?.privacy === 'local';
  if (user?.mediaAccess === false || contained) {
    return [];
  }
  return getConfiguredMediaTools(getMediaConfig(appConfig));
}

/** Server credentials for the OpenRouter calls; undefined when the endpoint is not usable. */
export function resolveMediaEndpoint(
  appConfig: AppConfig | null | undefined,
  config: TMediaGenerationConfig,
): MediaEndpoint | undefined {
  const endpoint = resolveSpeechEndpoint(appConfig, config.endpoint);
  return endpoint ? { ...endpoint, name: config.endpoint } : undefined;
}

export type MediaAccessResult = { ok: true } | { ok: false; code: 'media_disabled' | 'paid_only' };

/**
 * Whether this user may generate now: an admin's switch wins, admins may always, and otherwise a
 * `paidOnly` deployment needs a pack on the user's balance (bought or granted).
 */
export async function checkMediaAccess(
  config: TMediaGenerationConfig,
  user: MediaUser,
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>,
): Promise<MediaAccessResult> {
  if (user.mediaAccess === false) {
    return { ok: false, code: 'media_disabled' };
  }
  if (user.mediaAccess === true || user.role === SystemRoles.ADMIN || config.paidOnly !== true) {
    return { ok: true };
  }
  const balance = await findBalanceByUser(user.id);
  return balance?.packId ? { ok: true } : { ok: false, code: 'paid_only' };
}

/** The Higgsfield models and voices the model may pick, for the system prompt. */
export function buildMediaToolContext(
  appConfig: AppConfig | null | undefined,
  toolNames: readonly string[],
): Record<string, string> {
  const config = getMediaConfig(appConfig);
  const context: Record<string, string> = {};
  if (!config) {
    return context;
  }
  if (toolNames.includes(MediaTools.higgsfield) && config.higgsfield) {
    const lines = config.higgsfield.models.map(
      (model) =>
        `- ${model.id} (${model.kind}, $${model.priceUsd} per generation): ${model.label}${
          model.description ? ` — ${model.description}` : ''
        }`,
    );
    context[MediaTools.higgsfield] =
      `Higgsfield models you may pass as \`model\` to ${MediaTools.higgsfield}:\n${lines.join('\n')}`;
  }
  if (toolNames.includes(MediaTools.speech) && config.speech?.voices?.length) {
    context[MediaTools.speech] =
      `Voices for ${MediaTools.speech}: ${[config.speech.voice, ...config.speech.voices].join(', ')} (default ${config.speech.voice}).`;
  }
  return context;
}
