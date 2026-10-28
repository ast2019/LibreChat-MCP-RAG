import type {
  ImageResult,
  NewsResult,
  VideoResult,
  OrganicResult,
  TopStoryResult,
  AnswerBoxResult,
  PeopleAlsoAskResult,
  KnowledgeGraphResult,
} from '@librechat/agents';
import type { TSearchChainProvider, TSearchSkipReason } from 'librechat-data-provider';

export type SearchKind = 'search' | 'images' | 'news' | 'videos';

/** One search as the agents' Serper client sends it (`google.serper.dev/<kind>` body). */
export interface ChainSearchRequest {
  q: string;
  kind: SearchKind;
  num: number;
  /** Serper's `qdr:<h|d|w|m|y>` recency filter, reduced to its letter. */
  recency?: 'h' | 'd' | 'w' | 'm' | 'y';
  /** ISO 3166-1 alpha-2, lower case. */
  gl?: string;
  safe?: 'off' | 'moderate' | 'active';
}

/** The Serper response shape the agents' search pipeline maps (`createSerperAPI`). */
export interface SerperShapedResponse {
  organic: OrganicResult[];
  images: ImageResult[];
  topStories: TopStoryResult[];
  news: NewsResult[];
  videos: VideoResult[];
  answerBox?: AnswerBoxResult;
  knowledgeGraph?: KnowledgeGraphResult;
  peopleAlsoAsk?: PeopleAlsoAskResult[];
  relatedSearches?: Array<{ query: string }>;
}

/**
 * How a provider failed. `exhausted`, `rate_limited` and `unauthorized` take it out of the chain
 * for a while; `transient` and `invalid` only move this request on.
 */
export type ProviderFailureKind = TSearchSkipReason | 'transient' | 'invalid';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Stable, secret-free code, e.g. `http_429`, `serpapi_out_of_searches`, `timeout`. */
  code: string;
  /** Seconds the provider asked to wait (`Retry-After`). */
  retryAfterSeconds?: number;
}

export class SearchProviderError extends Error {
  readonly provider: TSearchChainProvider;
  readonly failure: ProviderFailure;

  constructor(provider: TSearchChainProvider, failure: ProviderFailure) {
    super(`${provider} search failed (${failure.code})`);
    this.name = 'SearchProviderError';
    this.provider = provider;
    this.failure = failure;
  }
}

export interface ChainProvider {
  name: TSearchChainProvider;
  /** Resolves a Serper-shaped response; rejects with `SearchProviderError`. */
  search(request: ChainSearchRequest): Promise<SerperShapedResponse>;
}

/** The subset of an axios instance providers call; tests pass a stub. */
export interface ChainHttp {
  request<T = unknown>(config: {
    method: 'GET' | 'POST';
    url: string;
    params?: Record<string, string | number | boolean | undefined>;
    data?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
    httpAgent?: unknown;
    httpsAgent?: unknown;
  }): Promise<{ status: number; data: T; headers?: Record<string, unknown> }>;
}

export interface ProviderSkip {
  reason: TSearchSkipReason;
  /** Epoch ms. */
  until: number;
  code: string;
}
