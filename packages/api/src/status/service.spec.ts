import { Keyv } from 'keyv';
import type { Response } from 'express';
import type { StatusConfig } from './service';
import {
  TAVILY_USAGE_URL,
  SERPER_ACCOUNT_URL,
  OPENROUTER_KEY_URL,
  SERPAPI_ACCOUNT_URL,
  OPENROUTER_CREDITS_URL,
  normalizeGateways,
} from './fetchers';
import { createServiceStatusService, computeHealth } from './service';
import { createFakeHttp, quota } from '~/web/chain/fixtures.helper';
import { estimateDaysLeft, appendHistory } from './history';
import { createChainStateStore } from '~/web/chain/state';
import { createAdminStatusHandlers } from './handlers';

const COOLDOWNS = {
  exhaustedCooldownSeconds: 3600,
  rateLimitCooldownSeconds: 60,
  unauthorizedCooldownSeconds: 3600,
};
const ENV = {
  SERPER_API_KEY: 'serper-key',
  SERPAPI_API_KEY: 'serpapi-key',
  TAVILY_API_KEY: 'tvly-key',
  OPENROUTER_KEY: 'or-key',
  SEARXNG_INSTANCE_URL: 'http://searxng:8080',
};
const NOW = Date.UTC(2026, 9, 27, 12);
const logger = { warn: jest.fn(), error: jest.fn() };

const ACCOUNTS = {
  [SERPER_ACCOUNT_URL]: { status: 200, data: { balance: 1200, rateLimit: 50 } },
  [SERPAPI_ACCOUNT_URL]: {
    status: 200,
    data: {
      plan_name: 'Developer',
      searches_per_month: 5000,
      plan_searches_left: 400,
      extra_credits: 0,
      total_searches_left: 400,
      this_month_usage: 4600,
      plan_renewal_date: '2026-11-01',
    },
  },
  [TAVILY_USAGE_URL]: {
    status: 200,
    data: {
      key: { usage: 150, limit: null },
      account: { current_plan: 'Researcher', plan_usage: 900, plan_limit: 1000 },
    },
  },
  [OPENROUTER_CREDITS_URL]: quota(403, { error: { code: 403, message: 'Only management keys' } }),
  [OPENROUTER_KEY_URL]: {
    status: 200,
    data: {
      data: {
        limit: 100,
        limit_remaining: 74.5,
        usage: 25.5,
        usage_monthly: 25.5,
        limit_reset: 'monthly',
      },
    },
  },
  'http://searxng:8080/healthz': { status: 200, data: 'OK' },
  'http://ollama:11434/api/tags': { status: 200, data: { models: [{ name: 'gemma3:4b' }] } },
};

function setup(
  config: StatusConfig = {
    webSearch: { providerChain: ['serper', 'serpapi', 'tavily', 'searxng'] },
    serviceStatus: { ollamaUrl: 'http://ollama:11434' } as StatusConfig['serviceStatus'],
  },
  routes: Parameters<typeof createFakeHttp>[0] = ACCOUNTS,
  extra: Partial<Parameters<typeof createServiceStatusService>[0]> = {},
) {
  let now = NOW;
  const cache = new Keyv();
  const chainStore = createChainStateStore(new Keyv(), COOLDOWNS);
  const http = createFakeHttp(routes);
  const service = createServiceStatusService({
    cache,
    chainStore,
    http,
    logger,
    env: ENV,
    loadConfig: async () => config,
    now: () => now,
    ...extra,
  });
  return { service, http, chainStore, cache, advance: (ms: number) => (now += ms) };
}

describe('createServiceStatusService', () => {
  it('reports every service with remaining, percent, plan, reset and health', async () => {
    const { service } = setup(undefined, ACCOUNTS, {
      getSmsBalance: async () => ({ remainingRial: 5_000_000 }),
      getPaymentGatewaysStatus: async () => [
        { name: 'zarinpal', configured: true, healthy: true },
        { name: 'idpay', configured: false, healthy: false },
      ],
    });
    const status = await service.get();
    const byId = Object.fromEntries(status.services.map((row) => [row.id, row]));

    expect(byId.serper).toMatchObject({
      configured: true,
      health: 'ok',
      remaining: 1200,
      unit: 'credits',
      chainPosition: 1,
    });
    expect(byId.serpapi).toMatchObject({
      remaining: 400,
      limit: 5000,
      remainingPercent: 8,
      usedThisPeriod: 4600,
      plan: 'Developer',
      resetAt: '2026-11-01',
      health: 'warning',
    });
    expect(byId.tavily).toMatchObject({
      remaining: 100,
      limit: 1000,
      remainingPercent: 10,
      health: 'warning',
    });
    expect(byId.openrouter).toMatchObject({
      unit: 'usd',
      remaining: 74.5,
      limit: 100,
      usedThisPeriod: 25.5,
      health: 'ok',
    });
    expect(byId.searxng).toMatchObject({ reachable: true, health: 'ok', chainPosition: 4 });
    expect(byId.ollama).toMatchObject({ reachable: true, health: 'ok' });
    expect(byId.sms).toMatchObject({ unit: 'rial', remaining: 5_000_000, health: 'ok' });
    expect(byId.payments).toMatchObject({
      health: 'ok',
      details: [{ name: 'zarinpal', healthy: true }],
    });
    expect(status).toMatchObject({
      activeSearchProvider: 'serper',
      chain: ['serper', 'serpapi', 'tavily', 'searxng'],
    });
  });

  it('marks unconfigured services and never sends a missing key', async () => {
    const { service, http } = setup({ webSearch: {} }, ACCOUNTS);
    const { services } = await service.refresh();
    const ids = services.filter((row) => row.health === 'unconfigured').map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining(['sms', 'payments', 'ollama']));
    expect(http.calls.some((call) => call.url.startsWith('http://ollama'))).toBe(false);
  });

  it('shows the failover skip and the next usable provider as active', async () => {
    const { service, chainStore } = setup();
    await chainStore.markFailure('serper', { kind: 'exhausted', code: 'serper_no_credits' }, NOW);
    const status = await service.get();

    expect(status.services.find((row) => row.id === 'serper')).toMatchObject({
      health: 'ok',
      skip: null,
    });
    // The account reported credits again, so the refresh ended the exhaustion.
    expect(await chainStore.getSkip('serper', NOW)).toBeNull();

    await chainStore.markFailure(
      'serpapi',
      { kind: 'exhausted', code: 'serpapi_out_of_searches' },
      NOW,
    );
    const next = await service.get();
    expect(next.services.find((row) => row.id === 'serpapi')).toMatchObject({
      health: 'exhausted',
      skip: {
        reason: 'exhausted',
        code: 'serpapi_out_of_searches',
        until: '2026-11-01T00:00:00.000Z',
      },
    });
    expect(next.activeSearchProvider).toBe('serper');
  });

  it('reports a failed check as an error with a safe code only', async () => {
    const { service } = setup(undefined, {
      ...ACCOUNTS,
      [SERPER_ACCOUNT_URL]: quota(403, { message: 'Unauthorized. key=serper-key' }),
      'http://searxng:8080/healthz': { error: { code: 'ECONNREFUSED' } },
    });
    const { services } = await service.refresh();
    const serper = services.find((row) => row.id === 'serper');

    expect(serper).toMatchObject({ health: 'error', reachable: false, errorCode: 'http_403' });
    expect(JSON.stringify(services)).not.toContain('serper-key');
    expect(services.find((row) => row.id === 'searxng')).toMatchObject({
      errorCode: 'network',
      health: 'error',
    });
  });

  it('caches the snapshot: get() does not call the providers again', async () => {
    const { service, http } = setup();
    await service.get();
    const calls = http.calls.length;
    await service.get();

    expect(http.calls.length).toBe(calls);
    await service.refresh();
    expect(http.calls.length).toBeGreaterThan(calls);
  });

  it('estimates days until exhaustion from the daily remaining history', async () => {
    const routes = (left: number) => ({
      ...ACCOUNTS,
      [SERPAPI_ACCOUNT_URL]: {
        status: 200,
        data: { searches_per_month: 5000, total_searches_left: left },
      },
    });
    let left = 1000;
    const http = createFakeHttp({
      ...routes(left),
      [SERPAPI_ACCOUNT_URL]: () => ({
        status: 200,
        data: { searches_per_month: 1000, total_searches_left: left },
      }),
    });
    const { service, advance } = setup(undefined, {}, { http });
    await service.refresh();
    advance(24 * 3600_000);
    left = 900;
    const status = await service.refresh();

    expect(status.services.find((row) => row.id === 'serpapi')).toMatchObject({
      remaining: 900,
      daysUntilExhausted: 9,
      health: 'ok',
    });
  });

  it('start() is off without a serviceStatus block', async () => {
    const { service, http } = setup({ webSearch: {} });
    const stop = await service.start();
    stop();

    expect(http.calls).toHaveLength(0);
  });
});

describe('status helpers', () => {
  it('computeHealth flags low percent and few days, and exhausted beats warning', () => {
    const base = { configured: true, reachable: true, remaining: 50, skip: null, errorCode: null };
    const thresholds = { warningPercent: 20, warningDays: 7 };

    expect(
      computeHealth({ ...base, remainingPercent: 50, daysUntilExhausted: 30 }, thresholds),
    ).toBe('ok');
    expect(
      computeHealth({ ...base, remainingPercent: 15, daysUntilExhausted: null }, thresholds),
    ).toBe('warning');
    expect(
      computeHealth({ ...base, remainingPercent: 90, daysUntilExhausted: 3 }, thresholds),
    ).toBe('warning');
    expect(computeHealth({ ...base, remaining: 0, remainingPercent: 0 }, thresholds)).toBe(
      'exhausted',
    );
    expect(computeHealth({ ...base, configured: false }, thresholds)).toBe('unconfigured');
  });

  it('estimateDaysLeft restarts after a top-up and ignores short spans', () => {
    const day = 24 * 3600_000;
    let history = appendHistory([], 100, NOW - 3 * day, 30);
    history = appendHistory(history, 40, NOW - 2 * day, 30);
    history = appendHistory(history, 500, NOW - day, 30);

    expect(estimateDaysLeft(history, 400, NOW)).toBe(4);
    expect(
      estimateDaysLeft([{ day: 'x', at: NOW - 3600_000, remaining: 500 }], 400, NOW),
    ).toBeNull();
  });

  it('normalizeGateways drops unnamed rows and unsafe codes', () => {
    expect(
      normalizeGateways({
        gateways: [
          { id: 'idpay', ok: true, code: 'fine' },
          { healthy: true },
          { name: 'z', errorCode: 'a b <c>' },
        ],
      }),
    ).toEqual([
      { name: 'idpay', configured: undefined, healthy: true, errorCode: 'fine' },
      { name: 'z', configured: undefined, healthy: false, errorCode: null },
    ]);
  });
});

describe('createAdminStatusHandlers', () => {
  const response = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  };

  it('answers 500 with a stable code when the status cannot be loaded', async () => {
    const service = {
      get: jest.fn().mockRejectedValue(new Error('redis password=hunter2')),
      refresh: jest.fn(),
      start: jest.fn(),
    };
    const res = response();
    await createAdminStatusHandlers(service).get({} as never, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'status_unavailable' });
  });

  it('refresh() runs the service refresh', async () => {
    const payload = { services: [] };
    const service = {
      get: jest.fn(),
      refresh: jest.fn().mockResolvedValue(payload),
      start: jest.fn(),
    };
    const res = response();
    await createAdminStatusHandlers(service as never).refresh(
      {} as never,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });
});
