import { Keyv } from 'keyv';
import type { ChainProvider, ChainSearchRequest, ProviderFailure } from './types';
import { createSearchChain, SearchChainError } from './chain';
import { createChainStateStore } from './state';
import { SearchProviderError } from './types';
import { emptyResponse } from './providers';

const COOLDOWNS = {
  exhaustedCooldownSeconds: 3600,
  rateLimitCooldownSeconds: 60,
  unauthorizedCooldownSeconds: 1800,
};
const REQUEST: ChainSearchRequest = { q: 'x', kind: 'search', num: 5 };
const logger = { warn: jest.fn(), error: jest.fn() };

function provider(
  name: ChainProvider['name'],
  outcome: 'ok' | ProviderFailure,
): ChainProvider & { search: jest.Mock } {
  return {
    name,
    search: jest.fn(async () => {
      if (outcome === 'ok') {
        return { ...emptyResponse(), organic: [{ link: `https://${name}.example.com` }] };
      }
      throw new SearchProviderError(name, outcome);
    }),
  };
}

describe('createSearchChain', () => {
  let cache: Keyv;
  beforeEach(() => {
    cache = new Keyv();
    jest.clearAllMocks();
  });

  it('answers from the first provider and records it as served', async () => {
    const store = createChainStateStore(cache, COOLDOWNS);
    const serper = provider('serper', 'ok');
    const serpapi = provider('serpapi', 'ok');
    const chain = createSearchChain({ providers: [serper, serpapi], store, logger });

    await expect(chain.search(REQUEST)).resolves.toMatchObject({ provider: 'serper' });
    expect(serpapi.search).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await store.getActive()).toMatchObject({ provider: 'serper' });
  });

  it('on a quota error marks the provider exhausted and moves to the next', async () => {
    const store = createChainStateStore(cache, COOLDOWNS);
    const serper = provider('serper', { kind: 'exhausted', code: 'serper_no_credits' });
    const serpapi = provider('serpapi', 'ok');
    const chain = createSearchChain({ providers: [serper, serpapi], store, logger });

    await expect(chain.search(REQUEST)).resolves.toMatchObject({ provider: 'serpapi' });
    expect(await store.getSkip('serper')).toMatchObject({
      reason: 'exhausted',
      code: 'serper_no_credits',
    });

    await chain.search(REQUEST);
    expect(serper.search).toHaveBeenCalledTimes(1);
  });

  it('on a transient error moves on for this request only', async () => {
    const store = createChainStateStore(cache, COOLDOWNS);
    const serper = provider('serper', { kind: 'transient', code: 'http_503' });
    const tavily = provider('tavily', 'ok');
    const chain = createSearchChain({ providers: [serper, tavily], store, logger });

    await expect(chain.search(REQUEST)).resolves.toMatchObject({ provider: 'tavily' });
    expect(await store.getSkip('serper')).toBeNull();
    await chain.search(REQUEST);
    expect(serper.search).toHaveBeenCalledTimes(2);
  });

  it('falls through to SearXNG when every paid provider is out, then fails with codes only', async () => {
    const store = createChainStateStore(cache, COOLDOWNS);
    const paid = [
      provider('serper', { kind: 'exhausted', code: 'serper_no_credits' }),
      provider('serpapi', { kind: 'exhausted', code: 'serpapi_out_of_searches' }),
      provider('tavily', { kind: 'exhausted', code: 'tavily_plan_limit' }),
    ];
    const searxng = provider('searxng', 'ok');
    await expect(
      createSearchChain({ providers: [...paid, searxng], store, logger }).search(REQUEST),
    ).resolves.toMatchObject({ provider: 'searxng' });

    const down = provider('searxng', { kind: 'transient', code: 'network' });
    const error = await createSearchChain({ providers: [...paid, down], store, logger })
      .search(REQUEST)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SearchChainError);
    expect((error as SearchChainError).attempts).toEqual([
      { provider: 'serper', code: 'skipped' },
      { provider: 'serpapi', code: 'skipped' },
      { provider: 'tavily', code: 'skipped' },
      { provider: 'searxng', code: 'network' },
    ]);
  });

  it('still searches when the shared cache cannot be read', async () => {
    const broken = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
      delete: jest.fn(),
    };
    const store = createChainStateStore(broken, COOLDOWNS);
    const chain = createSearchChain({ providers: [provider('serper', 'ok')], store, logger });

    await expect(chain.search(REQUEST)).resolves.toMatchObject({ provider: 'serper' });
  });
});

describe('createChainStateStore persistence', () => {
  it('shares an exhaustion across stores on the same cache, until the cooldown ends', async () => {
    const cache = new Keyv();
    const replicaA = createChainStateStore(cache, COOLDOWNS);
    const replicaB = createChainStateStore(cache, COOLDOWNS);
    const now = Date.UTC(2026, 9, 27, 12);

    await replicaA.markFailure('tavily', { kind: 'exhausted', code: 'tavily_plan_limit' }, now);

    expect(await replicaB.getSkip('tavily', now + 1000)).toMatchObject({ until: now + 3600_000 });
    expect(await replicaB.getSkip('tavily', now + 3600_001)).toBeNull();
  });

  it('waits for a known reset date, rate limits honour Retry-After, transient errors leave no mark', async () => {
    const store = createChainStateStore(new Keyv(), COOLDOWNS);
    const now = Date.UTC(2026, 9, 27, 12);
    const reset = Date.UTC(2026, 10, 1);
    await store.setResetHint('serpapi', reset);

    await store.markFailure('serpapi', { kind: 'exhausted', code: 'serpapi_out_of_searches' }, now);
    await store.markFailure(
      'tavily',
      { kind: 'rate_limited', code: 'http_429', retryAfterSeconds: 30 },
      now,
    );
    await store.markFailure('serper', { kind: 'unauthorized', code: 'http_403' }, now);
    await store.markFailure('searxng', { kind: 'transient', code: 'http_502' }, now);

    expect(await store.getSkip('serpapi', now)).toMatchObject({ until: reset });
    expect(await store.getSkip('tavily', now)).toMatchObject({
      reason: 'rate_limited',
      until: now + 30_000,
    });
    expect(await store.getSkip('serper', now)).toMatchObject({
      reason: 'unauthorized',
      until: now + 1800_000,
    });
    expect(await store.getSkip('searxng', now)).toBeNull();
  });

  it('counts searches per day', async () => {
    const store = createChainStateStore(new Keyv(), COOLDOWNS);
    const day = Date.UTC(2026, 9, 27, 12);
    await store.recordServed('serper', day - 86_400_000);
    await store.recordServed('serper', day);
    await store.recordServed('serper', day);

    expect(await store.getDailyUsage('serper', 3, day)).toEqual([0, 1, 2]);
  });
});
