import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ChainSearchRequest, SearchKind } from './types';
import type { SearchChain } from './chain';

/**
 * `@librechat/agents` builds its search client inside `createSearchTool` and offers no way to
 * pass one in. Its Serper client posts through the shared axios instance with the agents the
 * tool was given, so the chain hands it per-tool marker agents: an interceptor that recognises
 * a marker swaps the real (SSRF-guarded) agents back and answers Serper search calls from the
 * chain. Scraper and reranker requests carry the same markers and pass through untouched,
 * apart from the Serper scraper receiving the real Serper key. A marker that somehow reached
 * the network would carry only `CHAIN_PLACEHOLDER_KEY`.
 */
export const CHAIN_PLACEHOLDER_KEY = 'librechat-search-chain';

const SERPER_SEARCH_HOST = 'google.serper.dev';
const SERPER_SCRAPE_HOST = 'scrape.serper.dev';
const KINDS: Record<string, SearchKind> = {
  '/search': 'search',
  '/images': 'images',
  '/news': 'news',
  '/videos': 'videos',
};
const RECENCY = new Set(['h', 'd', 'w', 'm', 'y']);
const SAFE = new Set(['off', 'moderate', 'active']);

interface Binding {
  chain: SearchChain;
  httpAgent?: unknown;
  httpsAgent?: unknown;
  serperApiKey?: string;
}

const bindings = new WeakMap<object, Binding>();
const installed = new WeakSet<AxiosInstance>();

function getBinding(config: InternalAxiosRequestConfig): Binding | undefined {
  for (const agent of [config.httpsAgent, config.httpAgent]) {
    if (typeof agent === 'object' && agent !== null) {
      const binding = bindings.get(agent as object);
      if (binding) {
        return binding;
      }
    }
  }
  return undefined;
}

function parseUrl(config: InternalAxiosRequestConfig): URL | null {
  try {
    return new URL(config.url ?? '', config.baseURL);
  } catch {
    return null;
  }
}

/** Reads the agents' Serper payload (`q`, `num`, `tbs: qdr:<x>`, `gl`, `safe`). */
export function parseSerperPayload(raw: unknown, kind: SearchKind): ChainSearchRequest {
  let body: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      body =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
  } else if (typeof raw === 'object' && raw !== null) {
    body = raw as Record<string, unknown>;
  }
  const num = typeof body.num === 'number' && Number.isFinite(body.num) ? body.num : 8;
  const tbs = typeof body.tbs === 'string' ? body.tbs.replace(/^qdr:/, '') : undefined;
  const gl =
    typeof body.gl === 'string' && /^[a-z]{2}$/i.test(body.gl) ? body.gl.toLowerCase() : undefined;
  const safe = typeof body.safe === 'string' && SAFE.has(body.safe) ? body.safe : undefined;
  return {
    q: typeof body.q === 'string' ? body.q : '',
    kind,
    num: Math.min(Math.max(1, Math.round(num)), 20),
    recency: tbs != null && RECENCY.has(tbs) ? (tbs as ChainSearchRequest['recency']) : undefined,
    gl,
    safe: safe as ChainSearchRequest['safe'],
  };
}

function routeRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const binding = getBinding(config);
  if (!binding) {
    return config;
  }
  config.httpAgent = binding.httpAgent;
  config.httpsAgent = binding.httpsAgent;

  const url = parseUrl(config);
  if (url?.hostname === SERPER_SEARCH_HOST && KINDS[url.pathname] != null) {
    const request = parseSerperPayload(config.data, KINDS[url.pathname]);
    const { chain } = binding;
    config.adapter = async (adapterConfig): Promise<AxiosResponse> => {
      const { data } = await chain.search(request);
      return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: adapterConfig,
        request: {},
      };
    };
    return config;
  }
  if (url?.hostname === SERPER_SCRAPE_HOST && binding.serperApiKey) {
    config.headers.set('X-API-KEY', binding.serperApiKey);
  }
  return config;
}

/** Adds the routing interceptor to the axios instance `@librechat/agents` uses; idempotent. */
export function installSearchRouting(instance: AxiosInstance): void {
  if (installed.has(instance)) {
    return;
  }
  installed.add(instance);
  instance.interceptors.request.use(routeRequest, undefined, {
    runWhen: (config) => getBinding(config) != null,
  });
}

/**
 * Marker agents to pass to `createSearchTool` in place of the real ones; requests carrying them
 * are routed through `chain`. Bindings are weak: they end with the tool that holds the markers.
 */
export function bindSearchChain(binding: Binding): {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
} {
  const httpAgent = new HttpAgent();
  const httpsAgent = new HttpsAgent();
  bindings.set(httpAgent, binding);
  bindings.set(httpsAgent, binding);
  return { httpAgent, httpsAgent };
}
