import {
  MediaTools,
  SystemRoles,
  findPackGrants,
  extractEnvVariable,
  resolveMediaAccess,
  mediaGenerationSchema,
} from 'librechat-data-provider';
import type {
  TModelSpec,
  TPackGrants,
  TEffectiveAccess,
  TMediaGenerationConfig,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { resolveSpeechEndpoint } from '~/speech/config';
import { readConfigSection } from '~/app/config';
import type { MediaEndpoint, MediaUser } from './types';

const envVarPattern = /^\$\{.+\}$/;

/** The deployment's `mediaGeneration` settings, or null when off or invalid. Secrets are read
 *  from the environment; a Higgsfield block whose keys do not resolve is dropped. */
export function getMediaConfig(appConfig?: AppConfig | null): TMediaGenerationConfig | null {
  const raw = readConfigSection(appConfig, 'mediaGeneration');
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

export type MediaAccessResult =
  | { ok: true }
  | { ok: false; code: 'media_disabled' | 'paid_only' | 'not_in_pack' };

type PackList = ReadonlyArray<{ id?: string; grants?: TPackGrants }> | null | undefined;

/**
 * The media access of a user whose balance pack is known: the shared rule
 * ({@link resolveMediaAccess}) with this deployment's `paidOnly` and the pack's `grants`.
 */
export function resolveUserMediaAccess(
  config: Pick<TMediaGenerationConfig, 'paidOnly'> | null | undefined,
  user: Pick<MediaUser, 'role' | 'mediaAccess'>,
  packId: string | null | undefined,
  packs: PackList,
): TEffectiveAccess {
  return resolveMediaAccess({
    override: user.mediaAccess,
    isAdmin: user.role === SystemRoles.ADMIN,
    paidOnly: config?.paidOnly !== false,
    hasPack: Boolean(packId),
    packGrant: findPackGrants(packs, packId)?.media,
  });
}

/**
 * Whether this user may generate now: an admin's switch wins, admins may always, then the
 * current pack's `grants.media`, and otherwise a `paidOnly` deployment needs a pack on the
 * user's balance (bought or granted). The balance is read only when the answer depends on it.
 */
export async function checkMediaAccess(
  config: TMediaGenerationConfig,
  user: MediaUser,
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>,
  packs?: PackList,
): Promise<MediaAccessResult> {
  if (user.mediaAccess === false) {
    return { ok: false, code: 'media_disabled' };
  }
  const packDecides = (packs ?? []).some((pack) => typeof pack.grants?.media === 'boolean');
  if (
    user.mediaAccess === true ||
    user.role === SystemRoles.ADMIN ||
    (config.paidOnly === false && !packDecides)
  ) {
    return { ok: true };
  }
  const balance = await findBalanceByUser(user.id);
  const access = resolveUserMediaAccess(config, user, balance?.packId, packs);
  if (access.allowed) {
    return { ok: true };
  }
  return { ok: false, code: balance?.packId ? 'not_in_pack' : 'paid_only' };
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
