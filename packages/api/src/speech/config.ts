import {
  hiveSttSchema,
  hiveTtsSchema,
  envVarRegex,
  extractEnvVariable,
} from 'librechat-data-provider';
import type { TServerSpeechConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { HiveSttConfig, HiveTtsConfig, SpeechEndpoint } from './types';
import { isEffectivePriceMultiplier } from '~/billing/markup';
import { getCustomEndpointConfig } from '~/app/config';
import { isUserProvided } from '~/utils';

/** `speech.stt.hive` with defaults applied, or `undefined` when it is not configured/valid. */
export function resolveHiveSttConfig(appConfig?: AppConfig | null): HiveSttConfig | undefined {
  const raw = appConfig?.speech?.stt?.hive;
  if (raw == null) {
    return undefined;
  }
  const parsed = hiveSttSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** `speech.tts.hive` with defaults applied, or `undefined` when it is not configured/valid. */
export function resolveHiveTtsConfig(appConfig?: AppConfig | null): HiveTtsConfig | undefined {
  const raw = appConfig?.speech?.tts?.hive;
  if (raw == null) {
    return undefined;
  }
  const parsed = hiveTtsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Server credentials of a custom endpoint for speech calls. Endpoints whose key or URL the user
 * provides are not used (speech runs on the deployment's account and is billed to the user), and
 * header templates are not forwarded.
 */
export function resolveSpeechEndpoint(
  appConfig: AppConfig | null | undefined,
  name: string,
): SpeechEndpoint | undefined {
  if (!appConfig) {
    return undefined;
  }
  const endpointConfig = getCustomEndpointConfig({ endpoint: name, appConfig });
  if (!endpointConfig) {
    return undefined;
  }
  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  const unresolved = (value: string) => !value || isUserProvided(value) || envVarRegex.test(value);
  if (unresolved(apiKey) || unresolved(baseURL)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(endpointConfig.headers ?? {})) {
    if (typeof value === 'string' && !value.includes('{{') && !envVarRegex.test(value)) {
      headers[key] = value;
    }
  }
  const addParams = endpointConfig.addParams as Record<string, unknown> | undefined;
  const provider =
    addParams?.provider != null && typeof addParams.provider === 'object'
      ? (addParams.provider as Record<string, unknown>)
      : undefined;
  const multiplier = endpointConfig.priceMultiplier;
  return {
    apiKey,
    baseURL,
    headers,
    provider,
    priceMultiplier: isEffectivePriceMultiplier(multiplier) ? multiplier : 1,
  };
}

/** The `serverSpeech` block of `/speech/config/get`; `undefined` when no hive provider is set. */
export function getServerSpeechClientConfig(
  appConfig?: AppConfig | null,
): TServerSpeechConfig | undefined {
  const stt = resolveHiveSttConfig(appConfig);
  const tts = resolveHiveTtsConfig(appConfig);
  if (!stt && !tts) {
    return undefined;
  }
  const merge = (a: string[] = [], b: string[] = []) => Array.from(new Set([...a, ...b]));
  return {
    ...(stt && {
      stt: {
        language: stt.language,
        maxDurationSeconds: stt.maxDurationSeconds,
        private: stt.private != null,
      },
    }),
    ...(tts && { tts: { voices: tts.voices, private: tts.private != null } }),
    localEndpoints: merge(stt?.localEndpoints, tts?.localEndpoints),
    privateEndpoints: merge(stt?.privateEndpoints, tts?.privateEndpoints),
  };
}
