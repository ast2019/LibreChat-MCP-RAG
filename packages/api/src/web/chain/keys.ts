import { AuthType, extractVariableName, normalizeSearxngEngines } from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import { resolveStoredConfigSecret } from '~/admin/secrets';

type Env = Readonly<Record<string, string | undefined>>;

export interface ChainCredentials {
  serper?: string;
  serpapi?: string;
  tavily?: string;
  searxng?: { instanceUrl: string; apiKey?: string; engines?: string; language?: string };
}

/**
 * A deployment value: a `${VAR}` reads the server environment, anything else is a yaml literal
 * or a value the admin config API stored (decrypted here). A user's saved key is never read:
 * the chain spends the deployment's own subscriptions.
 */
export function resolveDeploymentValue(value: string | undefined, env: Env): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const field = extractVariableName(value);
  const resolved = field ? env[field] : resolveStoredConfigSecret(value.trim());
  const trimmed = resolved?.trim();
  if (!trimmed || trimmed === AuthType.USER_PROVIDED) {
    return undefined;
  }
  return trimmed;
}

export function resolveChainCredentials(
  config: TCustomConfig['webSearch'] | undefined,
  env: Env = process.env,
): ChainCredentials {
  const serper = resolveDeploymentValue(config?.serperApiKey ?? '${SERPER_API_KEY}', env);
  const serpapi = resolveDeploymentValue(config?.serpapiApiKey ?? '${SERPAPI_API_KEY}', env);
  const tavily = resolveDeploymentValue(config?.tavilyApiKey ?? '${TAVILY_API_KEY}', env);
  const instanceUrl = resolveDeploymentValue(
    config?.searxngInstanceUrl ?? '${SEARXNG_INSTANCE_URL}',
    env,
  );
  return {
    serper,
    serpapi,
    tavily,
    searxng: instanceUrl
      ? {
          instanceUrl,
          apiKey: resolveDeploymentValue(config?.searxngApiKey ?? '${SEARXNG_API_KEY}', env),
          engines: normalizeSearxngEngines(config?.searxngSearchOptions?.engines),
          language: config?.searxngSearchOptions?.language,
        }
      : undefined,
  };
}
