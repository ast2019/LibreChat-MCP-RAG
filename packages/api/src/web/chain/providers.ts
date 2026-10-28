import type {
  ImageResult,
  NewsResult,
  VideoResult,
  OrganicResult,
  TopStoryResult,
} from '@librechat/agents';
import type { TSearchChainProvider } from 'librechat-data-provider';
import type { ChainHttp, ChainProvider, ChainSearchRequest, SerperShapedResponse } from './types';
import { classifyProviderError } from './classify';
import { SearchProviderError } from './types';

export const SERPER_BASE_URL = 'https://google.serper.dev';
export const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json';
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** SerpApi answers 200 with this error when Google found nothing: an empty result, not a failure. */
const SERPAPI_EMPTY = /hasn't returned any results/i;

interface Transport {
  http: ChainHttp;
  timeoutMs: number;
  httpAgent?: unknown;
  httpsAgent?: unknown;
}

type Json = Record<string, unknown>;

const asArray = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => typeof item === 'object' && item !== null)
    : [];
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asObject = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

function hostname(link?: string): string | undefined {
  if (!link) {
    return undefined;
  }
  try {
    return new URL(link).hostname;
  } catch {
    return undefined;
  }
}

export function emptyResponse(): SerperShapedResponse {
  return { organic: [], images: [], topStories: [], news: [], videos: [], relatedSearches: [] };
}

async function call<T>(
  provider: TSearchChainProvider,
  transport: Transport,
  config: Parameters<ChainHttp['request']>[0],
): Promise<T> {
  try {
    const response = await transport.http.request<T>({
      ...config,
      timeout: transport.timeoutMs,
      httpAgent: transport.httpAgent,
      httpsAgent: transport.httpsAgent,
    });
    return response.data;
  } catch (error) {
    throw new SearchProviderError(provider, classifyProviderError(provider, error));
  }
}

/* ----------------------------------- Serper ----------------------------------- */

/** Serper: the shape the pipeline expects already; only defaults are filled. */
export function mapSerperResponse(data: Json): SerperShapedResponse {
  return {
    organic: asArray(data.organic) as unknown as OrganicResult[],
    images: asArray(data.images) as ImageResult[],
    topStories: asArray(data.topStories) as unknown as TopStoryResult[],
    news: asArray(data.news) as NewsResult[],
    videos: asArray(data.videos) as VideoResult[],
    answerBox: asObject(data.answerBox),
    knowledgeGraph: asObject(data.knowledgeGraph),
    peopleAlsoAsk: asArray(data.peopleAlsoAsk),
    relatedSearches: asArray(data.relatedSearches) as Array<{ query: string }>,
  };
}

export function createSerperProvider(apiKey: string, transport: Transport): ChainProvider {
  return {
    name: 'serper',
    async search(request) {
      const payload: Json = { q: request.q, num: request.num };
      if (request.safe) {
        payload.safe = request.safe;
      }
      if (request.gl) {
        payload.gl = request.gl;
      }
      if (request.recency) {
        payload.tbs = `qdr:${request.recency}`;
      }
      const data = await call<Json>('serper', transport, {
        method: 'POST',
        url: `${SERPER_BASE_URL}/${request.kind}`,
        data: payload,
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      });
      return mapSerperResponse(asObject(data) ?? {});
    },
  };
}

/* ----------------------------------- SerpApi ---------------------------------- */

const SERPAPI_TBM: Record<ChainSearchRequest['kind'], string | undefined> = {
  search: undefined,
  images: 'isch',
  news: 'nws',
  videos: 'vid',
};

function mapSerpApiImages(items: Json[]): ImageResult[] {
  return items.slice(0, 10).flatMap((item, index) => {
    const imageUrl = asString(item.original) ?? asString(item.thumbnail);
    if (!imageUrl) {
      return [];
    }
    const link = asString(item.link);
    return [
      {
        title: asString(item.title),
        imageUrl,
        imageWidth: asNumber(item.original_width),
        imageHeight: asNumber(item.original_height),
        thumbnailUrl: asString(item.thumbnail),
        source: asString(item.source),
        domain: hostname(link),
        link,
        position: asNumber(item.position) ?? index + 1,
      },
    ];
  });
}

function mapSerpApiVideos(items: Json[]): VideoResult[] {
  return items.map((item, index) => ({
    title: asString(item.title),
    link: asString(item.link),
    snippet: asString(item.snippet),
    imageUrl: asString(item.thumbnail),
    duration: asString(item.duration),
    source: asString(item.platform) ?? hostname(asString(item.link)),
    channel: asString(asObject(item.channel)?.name) ?? asString(item.channel),
    date: asString(item.date),
    position: asNumber(item.position) ?? index + 1,
  }));
}

/** SerpApi Google results (serpapi.com/search-api) in Serper's shape. */
export function mapSerpApiResponse(
  data: Json,
  kind: ChainSearchRequest['kind'],
): SerperShapedResponse {
  const result = emptyResponse();
  if (kind === 'images') {
    result.images = mapSerpApiImages(asArray(data.images_results));
    return result;
  }
  if (kind === 'videos') {
    result.videos = mapSerpApiVideos(asArray(data.video_results));
    return result;
  }
  if (kind === 'news') {
    result.news = asArray(data.news_results).flatMap((item, index) => {
      const link = asString(item.link);
      if (!link) {
        return [];
      }
      const source = asString(item.source) ?? asString(asObject(item.source)?.name);
      return [
        {
          title: asString(item.title),
          link,
          snippet: asString(item.snippet),
          date: asString(item.date),
          source: source ?? hostname(link),
          imageUrl: asString(item.thumbnail),
          position: asNumber(item.position) ?? index + 1,
        },
      ];
    });
    return result;
  }

  result.organic = asArray(data.organic_results).flatMap((item, index) => {
    const link = asString(item.link);
    if (!link) {
      return [];
    }
    const sitelinks = asArray(
      asObject(item.sitelinks)?.inline ?? asObject(item.sitelinks)?.expanded,
    )
      .map((site) => ({ title: asString(site.title) ?? '', link: asString(site.link) ?? '' }))
      .filter((site) => site.link !== '');
    return [
      {
        position: asNumber(item.position) ?? index + 1,
        title: asString(item.title),
        link,
        snippet: asString(item.snippet),
        date: asString(item.date),
        ...(sitelinks.length > 0 && { sitelinks }),
      },
    ];
  });
  result.topStories = asArray(data.top_stories).flatMap((item) => {
    const link = asString(item.link);
    return link
      ? [
          {
            title: asString(item.title),
            link,
            source: asString(item.source),
            date: asString(item.date),
            imageUrl: asString(item.thumbnail),
          },
        ]
      : [];
  });
  result.images = mapSerpApiImages(asArray(data.inline_images));
  result.videos = mapSerpApiVideos(asArray(data.inline_videos));
  result.peopleAlsoAsk = asArray(data.related_questions).map((item) => ({
    question: asString(item.question),
    snippet: asString(item.snippet),
    title: asString(item.title),
    link: asString(item.link),
  }));
  result.relatedSearches = asArray(data.related_searches).flatMap((item) => {
    const query = asString(item.query);
    return query ? [{ query }] : [];
  });

  const answer = asObject(data.answer_box);
  if (answer) {
    result.answerBox = {
      title: asString(answer.title),
      snippet: asString(answer.snippet) ?? asString(answer.answer) ?? asString(answer.result),
      snippetHighlighted: Array.isArray(answer.snippet_highlighted_words)
        ? answer.snippet_highlighted_words.filter(
            (word): word is string => typeof word === 'string',
          )
        : undefined,
      link: asString(answer.link),
      date: asString(answer.date),
    };
  }
  const graph = asObject(data.knowledge_graph);
  if (graph) {
    const source = asObject(graph.source);
    result.knowledgeGraph = {
      title: asString(graph.title),
      type: asString(graph.type),
      imageUrl: asString(asArray(graph.header_images)[0]?.image) ?? asString(graph.image),
      description: asString(graph.description),
      descriptionSource: asString(source?.name),
      descriptionLink: asString(source?.link),
      website: asString(graph.website),
    };
  }
  return result;
}

export interface SerpApiOptions {
  hl: string;
  gl: string;
}

export function createSerpApiProvider(
  apiKey: string,
  options: SerpApiOptions,
  transport: Transport,
): ChainProvider {
  return {
    name: 'serpapi',
    async search(request) {
      const params: Record<string, string | number | undefined> = {
        engine: 'google',
        q: request.q,
        api_key: apiKey,
        hl: options.hl,
        gl: request.gl ?? options.gl,
        num: request.num,
        tbm: SERPAPI_TBM[request.kind],
        safe: request.safe === 'active' ? 'active' : undefined,
        tbs: request.recency ? `qdr:${request.recency}` : undefined,
      };
      const data = asObject(
        await call<Json>('serpapi', transport, { method: 'GET', url: SERPAPI_SEARCH_URL, params }),
      );
      const error = asString(data?.error);
      if (error != null) {
        if (SERPAPI_EMPTY.test(error)) {
          return emptyResponse();
        }
        throw new SearchProviderError('serpapi', { kind: 'invalid', code: 'serpapi_error' });
      }
      return mapSerpApiResponse(data ?? {}, request.kind);
    },
  };
}

/* ----------------------------------- Tavily ----------------------------------- */

const TAVILY_TIME_RANGE: Record<NonNullable<ChainSearchRequest['recency']>, string> = {
  h: 'day',
  d: 'day',
  w: 'week',
  m: 'month',
  y: 'year',
};

/** Tavily search results (docs.tavily.com, POST /search) in Serper's shape. */
export function mapTavilyResponse(
  data: Json,
  kind: ChainSearchRequest['kind'],
): SerperShapedResponse {
  const result = emptyResponse();
  const organic = asArray(data.results).flatMap((item) => {
    const link = asString(item.url);
    return link
      ? [
          {
            title: asString(item.title),
            link,
            snippet: asString(item.content),
            date: asString(item.published_date),
          },
        ]
      : [];
  });
  result.images = (Array.isArray(data.images) ? data.images : [])
    .slice(0, 6)
    .flatMap((image: unknown, index: number) => {
      const imageUrl = typeof image === 'string' ? image : asString(asObject(image)?.url);
      return imageUrl
        ? [{ imageUrl, title: asString(asObject(image)?.description), position: index + 1 }]
        : [];
    });
  if (kind === 'images') {
    return result;
  }
  if (kind === 'news') {
    result.news = organic.map((item, index) => ({
      ...item,
      source: hostname(item.link),
      position: index + 1,
    }));
    return result;
  }
  result.organic = organic.map((item, index) => ({ ...item, position: index + 1 }));
  const answer = asString(data.answer);
  if (answer) {
    result.answerBox = { snippet: answer };
  }
  return result;
}

export function createTavilyProvider(
  apiKey: string,
  transport: Transport,
  searchUrl: string = TAVILY_SEARCH_URL,
): ChainProvider {
  return {
    name: 'tavily',
    async search(request) {
      if (request.kind === 'videos') {
        return emptyResponse();
      }
      const payload: Json = {
        query: request.q,
        search_depth: 'basic',
        topic: request.kind === 'news' ? 'news' : 'general',
        max_results: Math.min(Math.max(1, request.num), 20),
      };
      if (request.kind === 'images') {
        payload.include_images = true;
      }
      if (request.recency) {
        payload.time_range = TAVILY_TIME_RANGE[request.recency];
      }
      const data = await call<Json>('tavily', transport, {
        method: 'POST',
        url: searchUrl,
        data: payload,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      return mapTavilyResponse(asObject(data) ?? {}, request.kind);
    },
  };
}

/* ----------------------------------- SearXNG ---------------------------------- */

const SEARXNG_CATEGORY: Record<ChainSearchRequest['kind'], string> = {
  search: 'general',
  images: 'images',
  news: 'news',
  videos: 'videos',
};
const SEARXNG_SAFE: Record<NonNullable<ChainSearchRequest['safe']>, number> = {
  off: 0,
  moderate: 1,
  active: 2,
};
const SEARXNG_TIME_RANGE: Partial<Record<NonNullable<ChainSearchRequest['recency']>, string>> = {
  d: 'day',
  h: 'day',
  m: 'month',
  y: 'year',
};

export interface SearxngOptions {
  instanceUrl: string;
  apiKey?: string;
  engines?: string;
  language?: string;
}

/** SearXNG JSON results in Serper's shape, matching the agents' own SearXNG mapping. */
export function mapSearxngResponse(data: Json, request: ChainSearchRequest): SerperShapedResponse {
  const result = emptyResponse();
  const rows = asArray(data.results);
  if (request.kind === 'images') {
    result.images = rows.flatMap((row, index) => {
      const imageUrl = asString(row.img_src);
      const link = asString(row.url);
      return imageUrl
        ? [
            {
              title: asString(row.title),
              imageUrl,
              link,
              source: hostname(link),
              domain: hostname(link),
              position: index + 1,
            },
          ]
        : [];
    });
    return result;
  }
  const mapped = rows.slice(0, request.num).flatMap((row, index) => {
    const link = asString(row.url);
    return link
      ? [
          {
            position: index + 1,
            title: asString(row.title),
            link,
            snippet: asString(row.content),
            date: asString(row.publishedDate),
          },
        ]
      : [];
  });
  if (request.kind === 'videos') {
    result.videos = mapped.map((row) => ({ ...row, source: hostname(row.link) }));
    return result;
  }
  if (request.kind === 'news') {
    result.news = mapped.map((row) => ({ ...row, source: hostname(row.link) }));
    return result;
  }
  result.organic = mapped;
  result.images = rows
    .filter((row) => asString(row.img_src))
    .slice(0, 6)
    .map((row, index) => ({
      title: asString(row.title),
      imageUrl: asString(row.img_src),
      link: asString(row.url),
      domain: hostname(asString(row.url)),
      position: index + 1,
    }));
  result.relatedSearches = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .filter((suggestion: unknown): suggestion is string => typeof suggestion === 'string')
    .map((query: string) => ({ query }));
  return result;
}

export function createSearxngProvider(
  options: SearxngOptions,
  transport: Transport,
): ChainProvider {
  const base = options.instanceUrl.replace(/\/+$/, '');
  const url = base.endsWith('/search') ? base : `${base}/search`;
  return {
    name: 'searxng',
    async search(request) {
      const headers: Record<string, string> = {};
      if (options.apiKey) {
        headers['X-API-Key'] = options.apiKey;
      }
      const data = await call<Json>('searxng', transport, {
        method: 'GET',
        url,
        headers,
        params: {
          q: request.q,
          format: 'json',
          pageno: 1,
          categories: SEARXNG_CATEGORY[request.kind],
          language: options.language || 'all',
          safesearch: SEARXNG_SAFE[request.safe ?? 'moderate'],
          engines: options.engines || undefined,
          time_range: request.recency ? SEARXNG_TIME_RANGE[request.recency] : undefined,
        },
      });
      return mapSearxngResponse(asObject(data) ?? {}, request);
    },
  };
}
