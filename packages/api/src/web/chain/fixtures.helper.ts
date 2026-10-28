import type { ChainHttp } from './types';

type RequestConfig = Parameters<ChainHttp['request']>[0];
export type FakeReply =
  | { status: number; data: unknown; headers?: Record<string, unknown> }
  | {
      error: {
        code?: string;
        response?: { status: number; data?: unknown; headers?: Record<string, unknown> };
      };
    };

/**
 * Test double for the provider HTTP client: answers by URL prefix and records each call.
 * Only external provider APIs are faked; everything else runs for real.
 */
export function createFakeHttp(
  routes: Record<string, FakeReply | ((config: RequestConfig) => FakeReply)>,
): ChainHttp & {
  calls: RequestConfig[];
} {
  const calls: RequestConfig[] = [];
  return {
    calls,
    async request<T>(config: RequestConfig) {
      calls.push(config);
      const match = Object.keys(routes)
        .filter((prefix) => config.url.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
      if (match == null) {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }
      const route = routes[match];
      const reply = typeof route === 'function' ? route(config) : route;
      if ('error' in reply) {
        throw Object.assign(new Error('Request failed'), reply.error);
      }
      return { status: reply.status, data: reply.data as T, headers: reply.headers };
    },
  };
}

export const SERPER_FIXTURE = {
  organic: [
    {
      title: 'Serper result',
      link: 'https://example.com/serper',
      snippet: 'From Serper',
      position: 1,
    },
  ],
  answerBox: { snippet: 'Serper answer' },
  peopleAlsoAsk: [{ question: 'Q?', snippet: 'A', title: 'T', link: 'https://example.com/q' }],
  relatedSearches: [{ query: 'related' }],
};

/** Trimmed from the SerpApi Google Search API example response. */
export const SERPAPI_FIXTURE = {
  search_metadata: { status: 'Success' },
  organic_results: [
    {
      position: 1,
      title: 'قهوه - ویکی‌پدیا',
      link: 'https://fa.wikipedia.org/wiki/قهوه',
      snippet: 'قهوه نوشیدنی است',
      date: '2 days ago',
      sitelinks: {
        inline: [{ title: 'تاریخچه', link: 'https://fa.wikipedia.org/wiki/قهوه#history' }],
      },
    },
    { position: 2, title: 'No link' },
  ],
  answer_box: { title: 'Coffee', answer: 'A brewed drink', link: 'https://example.com/answer' },
  knowledge_graph: {
    title: 'Coffee',
    type: 'Drink',
    description: 'Coffee is a beverage',
    source: { name: 'Wikipedia', link: 'https://en.wikipedia.org/wiki/Coffee' },
    header_images: [{ image: 'https://example.com/kg.jpg' }],
  },
  related_questions: [
    { question: 'Is coffee healthy?', snippet: 'Yes', link: 'https://example.com/h' },
  ],
  related_searches: [{ query: 'coffee beans' }],
  top_stories: [
    { title: 'Coffee news', link: 'https://news.example.com/1', source: 'News', date: '1h' },
  ],
  inline_images: [
    {
      original: 'https://example.com/i.jpg',
      title: 'Cup',
      source: 'ex',
      link: 'https://example.com/i',
    },
  ],
  inline_videos: [
    { title: 'Brew', link: 'https://youtube.com/v', duration: '3:00', platform: 'YouTube' },
  ],
};

export const TAVILY_FIXTURE = {
  query: 'coffee',
  answer: 'Tavily answer',
  images: ['https://example.com/t.jpg', { url: 'https://example.com/t2.jpg', description: 'Two' }],
  results: [
    {
      title: 'Tavily result',
      url: 'https://example.com/tavily',
      content: 'From Tavily',
      published_date: '2026-10-01',
    },
  ],
};

export const SEARXNG_FIXTURE = {
  results: [
    {
      title: 'SearXNG result',
      url: 'https://example.com/searx',
      content: 'From SearXNG',
      img_src: 'https://example.com/s.jpg',
    },
  ],
  suggestions: ['searx suggestion'],
};

export const quota = (
  status: number,
  data: unknown,
  headers?: Record<string, unknown>,
): FakeReply => ({
  error: { response: { status, data, headers } },
});
