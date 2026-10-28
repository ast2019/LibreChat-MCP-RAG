import axios from 'axios';
import { searchFailoverSchema } from 'librechat-data-provider';
import type { TCustomConfig, TSearchChainProvider } from 'librechat-data-provider';
import type { AxiosInstance } from 'axios';
import type { ChainCache, ChainStateStore } from './state';
import type { ChainHttp, ChainProvider } from './types';
import type { WebSearchAuthValues } from '../web';
import type { ChainCredentials } from './keys';
import {
  createSerperProvider,
  createTavilyProvider,
  createSearxngProvider,
  createSerpApiProvider,
} from './providers';
import { bindSearchChain, installSearchRouting, CHAIN_PLACEHOLDER_KEY } from './route';
import { resolveChainCredentials } from './keys';
import { createChainStateStore } from './state';
import { createSearchChain } from './chain';

interface ChainLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

let providerHttp: AxiosInstance | undefined;
/** A separate instance, so provider calls never meet the routing interceptor. */
export const getProviderHttp = (): ChainHttp => (providerHttp ??= axios.create());

/** The failover state over `cache` with the cooldowns `webSearch.providerFailover` sets. */
export function createWebSearchChainStore(
  cache: ChainCache,
  webSearchConfig: TCustomConfig['webSearch'] | undefined,
): ChainStateStore {
  return createChainStateStore(
    cache,
    searchFailoverSchema.parse(webSearchConfig?.providerFailover ?? {}),
  );
}

/** The configured chain, in order, with the providers that have no key or URL left out. */
export function buildChainProviders({
  chain,
  credentials,
  webSearchConfig,
  http,
  httpAgent,
  httpsAgent,
}: {
  chain: readonly TSearchChainProvider[];
  credentials: ChainCredentials;
  webSearchConfig: TCustomConfig['webSearch'] | undefined;
  http: ChainHttp;
  httpAgent?: unknown;
  httpsAgent?: unknown;
}): ChainProvider[] {
  const failover = searchFailoverSchema.parse(webSearchConfig?.providerFailover ?? {});
  const transport = { http, timeoutMs: failover.timeoutMs, httpAgent, httpsAgent };
  const providers: ChainProvider[] = [];
  for (const name of new Set(chain)) {
    if (name === 'serper' && credentials.serper) {
      providers.push(createSerperProvider(credentials.serper, transport));
    } else if (name === 'serpapi' && credentials.serpapi) {
      providers.push(
        createSerpApiProvider(
          credentials.serpapi,
          { hl: failover.serpapiHl, gl: failover.serpapiGl },
          transport,
        ),
      );
    } else if (name === 'tavily' && credentials.tavily) {
      providers.push(createTavilyProvider(credentials.tavily, transport));
    } else if (name === 'searxng' && credentials.searxng) {
      providers.push(createSearxngProvider(credentials.searxng, transport));
    }
  }
  return providers;
}

/**
 * Builds the web search tool over `webSearch.providerChain`, or returns null when no chain is
 * configured or none of its providers has credentials, so the caller keeps the single-provider
 * tool. Scraping, reranking and result formatting stay `@librechat/agents`' own: the tool is
 * created as a Serper tool whose Serper calls the chain answers (see `route.ts`).
 */
export function createChainedSearchTool<TConfig extends object, TTool>({
  webSearchConfig,
  authResult,
  httpAgent,
  httpsAgent,
  store,
  logger,
  createSearchTool,
  toolOptions,
  env,
  http = getProviderHttp(),
  axiosInstance = axios,
}: {
  webSearchConfig: TCustomConfig['webSearch'] | undefined;
  authResult: WebSearchAuthValues;
  httpAgent?: unknown;
  httpsAgent?: unknown;
  store: ChainStateStore;
  logger: ChainLogger;
  createSearchTool: (config: TConfig) => TTool;
  /** Callbacks and logger forwarded to `createSearchTool` unchanged. */
  toolOptions?: Record<string, unknown>;
  env?: Readonly<Record<string, string | undefined>>;
  http?: ChainHttp;
  axiosInstance?: AxiosInstance;
}): TTool | null {
  const chain = webSearchConfig?.providerChain;
  if (!chain || chain.length === 0) {
    return null;
  }
  const credentials = resolveChainCredentials(webSearchConfig, env);
  const providers = buildChainProviders({
    chain,
    credentials,
    webSearchConfig,
    http,
    httpAgent,
    httpsAgent,
  });
  if (providers.length === 0) {
    logger.warn(
      '[webSearch.chain] No provider in providerChain has credentials; using searchProvider',
    );
    return null;
  }

  installSearchRouting(axiosInstance);
  const markers = bindSearchChain({
    chain: createSearchChain({ providers, store, logger }),
    httpAgent,
    httpsAgent,
    serperApiKey: authResult.serperApiKey ?? credentials.serper,
  });
  return createSearchTool({
    ...authResult,
    ...toolOptions,
    searchProvider: 'serper',
    serperApiKey: CHAIN_PLACEHOLDER_KEY,
    httpAgent: markers.httpAgent,
    httpsAgent: markers.httpsAgent,
  } as unknown as TConfig);
}
