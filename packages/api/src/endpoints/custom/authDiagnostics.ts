import { createHash } from 'node:crypto';
import { EModelEndpoint, extractEnvVariable, extractVariableName } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { TEndpoint } from 'librechat-data-provider';
import { getCustomEndpointConfig } from '~/app/config';

/** Safe, shareable view of a secret: never the value itself. */
export type SecretPresence = {
  present: boolean;
  length: number;
  /** First 8 hex chars of SHA-256 over the trimmed value; empty when absent. */
  fingerprint: string;
  /** Env var name when the yaml field is `${NAME}`; omitted for literals. */
  env?: string;
};

export type BaseUrlPresence = {
  present: boolean;
  /** Hostname only; path/query stripped so shares stay short and non-sensitive. */
  host: string | null;
  env?: string;
};

/**
 * Diagnostics for a custom-endpoint auth failure (e.g. ClaudeTime gateway 401).
 * Explicitly separates credential rejection from `time_pack_required`.
 */
export type CustomEndpointAuthDiagnostics = {
  endpoint: string;
  failureKind: 'endpoint_credential_rejected';
  /** Always true so debug shares cannot be misread as a time-pack admit miss. */
  notTimePackRequired: true;
  apiKey: SecretPresence;
  baseURL: BaseUrlPresence;
  sdkProvider?: string;
};

export function fingerprintSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

export function describeSecretValue(
  value: string | undefined | null,
  env?: string | null,
): SecretPresence {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const present = trimmed.length > 0;
  return {
    present,
    length: present ? trimmed.length : 0,
    fingerprint: present ? fingerprintSecret(trimmed) : '',
    ...(env ? { env } : {}),
  };
}

export function describeBaseUrlHost(
  value: string | undefined | null,
  env?: string | null,
): BaseUrlPresence {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return { present: false, host: null, ...(env ? { env } : {}) };
  }
  let host: string | null = null;
  try {
    host = new URL(trimmed).host || null;
  } catch {
    /** Bare host without scheme — still useful in shares. */
    host = trimmed.split('/')[0] || null;
  }
  return { present: true, host, ...(env ? { env } : {}) };
}

function resolveConfiguredField(raw: unknown): {
  env: string | null;
  value: string;
} {
  if (typeof raw !== 'string') {
    return { env: null, value: '' };
  }
  const env = extractVariableName(raw);
  const value = extractEnvVariable(raw);
  /** Still looks like `${ENV}` → unset/empty; treat as absent. */
  if (env && value.trim() === raw.trim()) {
    return { env, value: '' };
  }
  return { env, value };
}

function findCustomEndpointConfig(
  endpoint: string,
  appConfig?: AppConfig,
): Partial<TEndpoint> | undefined {
  if (!appConfig) {
    return undefined;
  }
  try {
    return getCustomEndpointConfig({ endpoint, appConfig });
  } catch {
    return undefined;
  }
}

/**
 * Builds share-safe credential diagnostics for a named custom endpoint from its
 * yaml/`librechat` config and the current process env. Never returns secret values.
 */
export function buildCustomEndpointAuthDiagnostics({
  endpoint,
  appConfig,
}: {
  endpoint?: string | null;
  appConfig?: AppConfig;
}): CustomEndpointAuthDiagnostics | null {
  const name = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!name) {
    return null;
  }

  const config = findCustomEndpointConfig(name, appConfig);
  const apiKeyField = resolveConfiguredField(config?.apiKey);
  const baseURLField = resolveConfiguredField(config?.baseURL);

  return {
    endpoint: name,
    failureKind: 'endpoint_credential_rejected',
    notTimePackRequired: true,
    apiKey: describeSecretValue(apiKeyField.value, apiKeyField.env),
    baseURL: describeBaseUrlHost(baseURLField.value, baseURLField.env),
    ...(config?.provider != null ? { sdkProvider: String(config.provider) } : {}),
  };
}

/**
 * One-line ERROR message for debug share / problem logs. Includes endpoint, env
 * names, presence, fingerprint, and host — never the secret.
 */
export function formatEndpointAuthRejectionMessage(
  diagnostics: CustomEndpointAuthDiagnostics,
  status = 401,
): string {
  const keyEnv = diagnostics.apiKey.env ? ` env=${diagnostics.apiKey.env}` : '';
  const urlEnv = diagnostics.baseURL.env ? ` env=${diagnostics.baseURL.env}` : '';
  const host = diagnostics.baseURL.host ?? '(none)';
  return (
    `[${diagnostics.endpoint}] Upstream ${status}: endpoint credential/baseURL rejected by gateway ` +
    `(NOT time_pack_required). ` +
    `apiKey:${keyEnv} present=${diagnostics.apiKey.present} length=${diagnostics.apiKey.length} ` +
    `fingerprint=${diagnostics.apiKey.fingerprint || '(none)'}; ` +
    `baseURL:${urlEnv} present=${diagnostics.baseURL.present} host=${host}` +
    (diagnostics.sdkProvider ? ` sdkProvider=${diagnostics.sdkProvider}` : '')
  );
}

/** True when this endpoint is the ClaudeTime custom gateway (or any anthropic-backed custom). */
export function isCustomAnthropicEndpoint(
  endpoint: string | undefined | null,
  appConfig?: AppConfig,
): boolean {
  const name = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!name) {
    return false;
  }
  const config = findCustomEndpointConfig(name, appConfig);
  return config?.provider === EModelEndpoint.anthropic;
}
