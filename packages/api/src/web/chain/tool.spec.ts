import axios from 'axios';
import { Keyv } from 'keyv';
import { createSearchTool } from '@librechat/agents';
import type { ToolMessage } from '@langchain/core/messages';
import { SERPAPI_FIXTURE, TAVILY_FIXTURE, createFakeHttp, quota } from './fixtures.helper';
import { SERPER_BASE_URL, SERPAPI_SEARCH_URL, TAVILY_SEARCH_URL } from './providers';
import { createChainedSearchTool, createWebSearchChainStore } from './tool';

type ChainedSearchToolOptions = Parameters<typeof createChainedSearchTool>[0];
import { parseSerperPayload } from './route';

const logger = { warn: jest.fn(), error: jest.fn() };
const CHAIN = ['serper', 'serpapi', 'tavily', 'searxng'] as const;
const ENV = {
  SERPER_API_KEY: 'serper-key',
  SERPAPI_API_KEY: 'serpapi-key',
  TAVILY_API_KEY: 'tvly-key',
};
/** Scraping goes to a closed local port: it fails fast, and the search results still format. */
const AUTH = {
  scraperProvider: 'firecrawl',
  firecrawlApiKey: 'fc-key',
  firecrawlApiUrl: 'http://127.0.0.1:9',
  scraperTimeout: 500,
  rerankerType: 'none',
  safeSearch: 1,
} as unknown as ChainedSearchToolOptions['authResult'];

type Artifact = { web_search: { organic?: Array<{ link: string }>; error?: string } };

async function runSearch(tool: ReturnType<typeof createSearchTool>, query = 'coffee') {
  const message = (await tool.invoke({
    id: 'call-1',
    name: 'web_search',
    type: 'tool_call',
    args: { query },
  })) as ToolMessage;
  return message.artifact as Artifact;
}

describe('createChainedSearchTool', () => {
  it('returns null without a providerChain or without any chain credentials', () => {
    const store = createWebSearchChainStore(new Keyv(), undefined);
    const common = { authResult: AUTH, store, logger, createSearchTool, env: {} };

    expect(
      createChainedSearchTool({
        ...common,
        webSearchConfig: {},
      } as unknown as ChainedSearchToolOptions),
    ).toBeNull();
    expect(
      createChainedSearchTool({
        ...common,
        webSearchConfig: { providerChain: ['serper', 'tavily'] },
      }),
    ).toBeNull();
  });

  it('answers the agents search tool from SerpApi when Serper is out of credits', async () => {
    const http = createFakeHttp({
      [SERPER_BASE_URL]: quota(400, { message: 'Not enough credits', statusCode: 400 }),
      [SERPAPI_SEARCH_URL]: { status: 200, data: SERPAPI_FIXTURE },
    });
    const cache = new Keyv();
    const store = createWebSearchChainStore(cache, undefined);
    const tool = createChainedSearchTool({
      webSearchConfig: { providerChain: [...CHAIN] },
      authResult: AUTH,
      store,
      logger,
      createSearchTool,
      env: ENV,
      http,
    });
    expect(tool).not.toBeNull();

    const artifact = await runSearch(tool as ReturnType<typeof createSearchTool>);

    expect(artifact.web_search.error).toBeUndefined();
    expect(artifact.web_search.organic?.[0]?.link).toBe('https://fa.wikipedia.org/wiki/قهوه');
    expect(http.calls.map((call) => call.url)).toEqual([
      `${SERPER_BASE_URL}/search`,
      SERPAPI_SEARCH_URL,
    ]);
    expect(await store.getSkip('serper')).toMatchObject({
      reason: 'exhausted',
      code: 'serper_no_credits',
    });
  });

  it('skips the exhausted providers on the next request and uses Tavily', async () => {
    const http = createFakeHttp({
      [SERPER_BASE_URL]: { status: 200, data: {} },
      [SERPAPI_SEARCH_URL]: quota(429, { error: 'Your account has run out of searches.' }),
      [TAVILY_SEARCH_URL]: { status: 200, data: TAVILY_FIXTURE },
    });
    const store = createWebSearchChainStore(new Keyv(), undefined);
    await store.markFailure('serper', { kind: 'exhausted', code: 'serper_no_credits' });
    const tool = createChainedSearchTool({
      webSearchConfig: { providerChain: [...CHAIN] },
      authResult: AUTH,
      store,
      logger,
      createSearchTool,
      env: ENV,
      http,
    }) as ReturnType<typeof createSearchTool>;

    const artifact = await runSearch(tool);

    expect(artifact.web_search.organic?.[0]?.link).toBe('https://example.com/tavily');
    expect(http.calls.map((call) => call.url)).toEqual([SERPAPI_SEARCH_URL, TAVILY_SEARCH_URL]);
  });

  it('reports a clear, secret-free error when every provider is unavailable', async () => {
    const http = createFakeHttp({
      [SERPER_BASE_URL]: quota(403, { message: 'Unauthorized.' }),
    });
    const tool = createChainedSearchTool({
      webSearchConfig: { providerChain: ['serper'] },
      authResult: AUTH,
      store: createWebSearchChainStore(new Keyv(), undefined),
      logger,
      createSearchTool,
      env: ENV,
      http,
    }) as ReturnType<typeof createSearchTool>;

    const artifact = await runSearch(tool);

    expect(artifact.web_search.error).toContain(
      'No web search provider is available (serper: http_403)',
    );
    expect(artifact.web_search.error).not.toContain('serper-key');
  });

  it('leaves requests without the chain markers alone', async () => {
    const adapter = jest.fn(async (config) => ({
      data: 'plain',
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));
    const response = await axios.get('https://google.serper.dev/search', { adapter });

    expect(response.data).toBe('plain');
    expect(adapter).toHaveBeenCalled();
  });
});

describe('parseSerperPayload', () => {
  it('reads the agents Serper body, clamping and dropping unknown values', () => {
    expect(
      parseSerperPayload(
        JSON.stringify({ q: 'x', num: 50, tbs: 'qdr:w', gl: 'IR', safe: 'active' }),
        'news',
      ),
    ).toEqual({
      q: 'x',
      kind: 'news',
      num: 20,
      recency: 'w',
      gl: 'ir',
      safe: 'active',
    });
    expect(
      parseSerperPayload({ q: 'x', tbs: 'qdr:z', gl: 'iran', safe: 'strict' }, 'search'),
    ).toEqual({
      q: 'x',
      kind: 'search',
      num: 8,
      recency: undefined,
      gl: undefined,
      safe: undefined,
    });
  });
});
