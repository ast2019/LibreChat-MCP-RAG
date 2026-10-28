import {
  SERPER_BASE_URL,
  TAVILY_SEARCH_URL,
  SERPAPI_SEARCH_URL,
  createSerperProvider,
  createTavilyProvider,
  createSearxngProvider,
  createSerpApiProvider,
} from './providers';
import {
  SERPER_FIXTURE,
  TAVILY_FIXTURE,
  SEARXNG_FIXTURE,
  SERPAPI_FIXTURE,
  createFakeHttp,
  quota,
} from './fixtures.helper';
import { classifyProviderError } from './classify';
import { SearchProviderError } from './types';

const request = {
  q: 'coffee',
  kind: 'search' as const,
  num: 8,
  safe: 'moderate' as const,
  recency: 'd' as const,
  gl: 'ir',
};
const transport = (http: ReturnType<typeof createFakeHttp>) => ({ http, timeoutMs: 5000 });

describe('chain providers map to the Serper result shape', () => {
  it('Serper passes its own shape through and sends the key as X-API-KEY', async () => {
    const http = createFakeHttp({ [SERPER_BASE_URL]: { status: 200, data: SERPER_FIXTURE } });
    const result = await createSerperProvider('serper-key', transport(http)).search(request);

    expect(result.organic[0]).toMatchObject({
      link: 'https://example.com/serper',
      snippet: 'From Serper',
    });
    expect(result.answerBox).toEqual({ snippet: 'Serper answer' });
    expect(result.images).toEqual([]);
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: `${SERPER_BASE_URL}/search`,
      data: { q: 'coffee', num: 8, gl: 'ir', safe: 'moderate', tbs: 'qdr:d' },
      headers: { 'X-API-KEY': 'serper-key' },
      timeout: 5000,
    });
  });

  it('SerpApi maps organic, sitelinks, answer box, knowledge graph, questions, stories, images and videos', async () => {
    const http = createFakeHttp({ [SERPAPI_SEARCH_URL]: { status: 200, data: SERPAPI_FIXTURE } });
    const provider = createSerpApiProvider('serpapi-key', { hl: 'fa', gl: 'ir' }, transport(http));
    const result = await provider.search({ ...request, gl: undefined });

    expect(result.organic).toEqual([
      {
        position: 1,
        title: 'قهوه - ویکی‌پدیا',
        link: 'https://fa.wikipedia.org/wiki/قهوه',
        snippet: 'قهوه نوشیدنی است',
        date: '2 days ago',
        sitelinks: [{ title: 'تاریخچه', link: 'https://fa.wikipedia.org/wiki/قهوه#history' }],
      },
    ]);
    expect(result.answerBox).toMatchObject({ title: 'Coffee', snippet: 'A brewed drink' });
    expect(result.knowledgeGraph).toMatchObject({
      title: 'Coffee',
      descriptionSource: 'Wikipedia',
      imageUrl: 'https://example.com/kg.jpg',
    });
    expect(result.peopleAlsoAsk?.[0]).toMatchObject({ question: 'Is coffee healthy?' });
    expect(result.relatedSearches).toEqual([{ query: 'coffee beans' }]);
    expect(result.topStories[0]).toMatchObject({ link: 'https://news.example.com/1' });
    expect(result.images[0]).toMatchObject({
      imageUrl: 'https://example.com/i.jpg',
      domain: 'example.com',
    });
    expect(result.videos[0]).toMatchObject({ link: 'https://youtube.com/v', source: 'YouTube' });
    expect(http.calls[0].params).toMatchObject({
      engine: 'google',
      q: 'coffee',
      api_key: 'serpapi-key',
      hl: 'fa',
      gl: 'ir',
      num: 8,
      tbs: 'qdr:d',
    });
  });

  it('SerpApi asks Google for news and images with tbm and maps those lists', async () => {
    const http = createFakeHttp({
      [SERPAPI_SEARCH_URL]: (config) =>
        config.params?.tbm === 'nws'
          ? {
              status: 200,
              data: {
                news_results: [
                  { title: 'N', link: 'https://n.example.com/a', source: { name: 'NYT' } },
                ],
              },
            }
          : {
              status: 200,
              data: {
                images_results: [
                  { original: 'https://x.example.com/a.png', link: 'https://x.example.com' },
                ],
              },
            },
    });
    const provider = createSerpApiProvider('k', { hl: 'fa', gl: 'ir' }, transport(http));

    const news = await provider.search({ ...request, kind: 'news' });
    const images = await provider.search({ ...request, kind: 'images' });

    expect(news.news).toEqual([
      expect.objectContaining({ link: 'https://n.example.com/a', source: 'NYT' }),
    ]);
    expect(images.images[0]).toMatchObject({ imageUrl: 'https://x.example.com/a.png' });
    expect(http.calls.map((call) => call.params?.tbm)).toEqual(['nws', 'isch']);
  });

  it('SerpApi treats «no results» as an empty answer and other in-body errors as invalid', async () => {
    const empty = createFakeHttp({
      [SERPAPI_SEARCH_URL]: {
        status: 200,
        data: { error: "Google hasn't returned any results for this query." },
      },
    });
    await expect(
      createSerpApiProvider('k', { hl: 'fa', gl: 'ir' }, transport(empty)).search(request),
    ).resolves.toMatchObject({ organic: [] });

    const broken = createFakeHttp({
      [SERPAPI_SEARCH_URL]: { status: 200, data: { error: 'Invalid engine' } },
    });
    await expect(
      createSerpApiProvider('k', { hl: 'fa', gl: 'ir' }, transport(broken)).search(request),
    ).rejects.toMatchObject({ failure: { kind: 'invalid', code: 'serpapi_error' } });
  });

  it('Tavily maps results, answer and images, and sends a Bearer key', async () => {
    const http = createFakeHttp({ [TAVILY_SEARCH_URL]: { status: 200, data: TAVILY_FIXTURE } });
    const result = await createTavilyProvider('tvly-key', transport(http)).search(request);

    expect(result.organic).toEqual([
      {
        title: 'Tavily result',
        link: 'https://example.com/tavily',
        snippet: 'From Tavily',
        date: '2026-10-01',
        position: 1,
      },
    ]);
    expect(result.answerBox).toEqual({ snippet: 'Tavily answer' });
    expect(result.images).toEqual([
      { imageUrl: 'https://example.com/t.jpg', title: undefined, position: 1 },
      { imageUrl: 'https://example.com/t2.jpg', title: 'Two', position: 2 },
    ]);
    expect(http.calls[0]).toMatchObject({
      headers: { Authorization: 'Bearer tvly-key' },
      data: { query: 'coffee', topic: 'general', max_results: 8, time_range: 'day' },
    });
  });

  it('Tavily answers a video search with nothing, without spending a credit', async () => {
    const http = createFakeHttp({});
    const result = await createTavilyProvider('k', transport(http)).search({
      ...request,
      kind: 'videos',
    });

    expect(result.videos).toEqual([]);
    expect(http.calls).toHaveLength(0);
  });

  it('SearXNG maps results, images and suggestions from its JSON API', async () => {
    const http = createFakeHttp({
      'http://searxng:8080/search': { status: 200, data: SEARXNG_FIXTURE },
    });
    const provider = createSearxngProvider(
      { instanceUrl: 'http://searxng:8080/', engines: 'google,bing' },
      transport(http),
    );
    const result = await provider.search(request);

    expect(result.organic[0]).toMatchObject({
      link: 'https://example.com/searx',
      snippet: 'From SearXNG',
    });
    expect(result.images[0]).toMatchObject({ imageUrl: 'https://example.com/s.jpg' });
    expect(result.relatedSearches).toEqual([{ query: 'searx suggestion' }]);
    expect(http.calls[0].params).toMatchObject({
      format: 'json',
      engines: 'google,bing',
      safesearch: 1,
      time_range: 'day',
    });
  });

  it('wraps an HTTP failure in a classified SearchProviderError', async () => {
    const http = createFakeHttp({
      [TAVILY_SEARCH_URL]: quota(432, { detail: { error: 'secret-ish upstream text' } }),
    });
    const failure = await createTavilyProvider('k', transport(http))
      .search(request)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SearchProviderError);
    expect(failure).toMatchObject({
      provider: 'tavily',
      failure: { kind: 'exhausted', code: 'tavily_plan_limit' },
    });
    expect(String((failure as Error).message)).not.toContain('upstream text');
  });
});

describe('classifyProviderError', () => {
  const http = (status: number, data?: unknown, headers?: Record<string, unknown>) => ({
    response: { status, data, headers },
  });

  it.each([
    [
      'serper',
      http(400, { message: 'Not enough credits', statusCode: 400 }),
      'exhausted',
      'serper_no_credits',
    ],
    [
      'serper',
      http(403, { message: 'Unauthorized.', statusCode: 403 }),
      'unauthorized',
      'http_403',
    ],
    ['serper', http(402, {}), 'exhausted', 'http_402'],
    ['serper', http(429, {}), 'rate_limited', 'http_429'],
    [
      'serpapi',
      http(429, { error: 'Your account has run out of searches.' }),
      'exhausted',
      'serpapi_out_of_searches',
    ],
    [
      'serpapi',
      http(429, { error: 'Hourly throughput limit reached' }),
      'rate_limited',
      'http_429',
    ],
    ['serpapi', http(401, { error: 'Invalid API key.' }), 'unauthorized', 'http_401'],
    ['tavily', http(432, { detail: { error: 'plan limit' } }), 'exhausted', 'tavily_plan_limit'],
    ['tavily', http(433, { detail: { error: 'paygo' } }), 'exhausted', 'tavily_paygo_limit'],
    [
      'tavily',
      http(429, { detail: { error: 'Too many' } }, { 'retry-after': '30' }),
      'rate_limited',
      'http_429',
    ],
    ['tavily', http(422, {}), 'invalid', 'http_422'],
    ['searxng', http(502, 'Bad gateway'), 'transient', 'http_502'],
    ['serper', { code: 'ECONNABORTED' }, 'transient', 'timeout'],
    ['serper', { code: 'ECONNREFUSED' }, 'transient', 'network'],
  ] as const)('%s %j → %s', (provider, error, kind, code) => {
    expect(classifyProviderError(provider, error)).toMatchObject({ kind, code });
  });

  it('reads Retry-After for rate limits', () => {
    expect(classifyProviderError('tavily', http(429, {}, { 'retry-after': '30' }))).toMatchObject({
      retryAfterSeconds: 30,
    });
  });
});
