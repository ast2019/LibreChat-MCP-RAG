import { logger } from '@librechat/data-schemas';
import { balanceRialSchema } from 'librechat-data-provider';
import type { TBalanceRialConfig } from 'librechat-data-provider';
import {
  priceInRial,
  creditsToUsd,
  TGJU_RATE_URL,
  parseTgjuRate,
  createRialRateRegistry,
  createRialRateProvider,
} from './rial';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const payload = (p: unknown = '2,695,000', ts: unknown = '2026-10-25 19:27:58') => ({
  current: { price_dollar_rl: { p, ts } },
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const config = (over: Partial<TBalanceRialConfig> = {}): TBalanceRialConfig =>
  balanceRialSchema.parse({ enabled: true, ...over });

function setup(over: Partial<TBalanceRialConfig> = {}) {
  let clock = Date.parse('2026-10-25T16:00:00.000Z');
  const fetchMock = jest.fn().mockResolvedValue(jsonResponse(payload()));
  const provider = createRialRateProvider({
    config: config(over),
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock,
  });
  return {
    provider,
    fetchMock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe('pure helpers', () => {
  it('converts credits to USD', () => {
    expect(creditsToUsd(2_000_000)).toBe(2);
    expect(creditsToUsd(Number.NaN)).toBe(0);
  });

  it('rounds the rial price up to the step, without float overshoot', () => {
    expect(priceInRial(2_000_000, 3_234_000, 10_000)).toBe(6_470_000);
    expect(priceInRial(1_000_000, 3_234_000, 10_000)).toBe(3_240_000);
    expect(priceInRial(1_000_000, 3_240_000, 10_000)).toBe(3_240_000);
    expect(priceInRial(100_000, 2_695_000 * 1.2, 10_000)).toBe(330_000);
    expect(priceInRial(0, 3_234_000, 10_000)).toBe(0);
    expect(priceInRial(1_500_000, 1_000_001, 0)).toBe(1_500_002);
  });

  it('parses the tgju payload and its Tehran timestamp', () => {
    expect(parseTgjuRate(payload())).toEqual({
      marketRate: 2_695_000,
      updatedAt: '2026-10-25T15:57:58.000Z',
    });
    expect(parseTgjuRate(payload('2,695,000', 'garbage'))).toEqual({
      marketRate: 2_695_000,
      updatedAt: null,
    });
  });

  it.each([
    ['missing', {}],
    ['not a number', payload('n/a')],
    ['too small', payload('9,000')],
    ['too large', payload('1,000,000,000')],
    ['negative', payload('-2,695,000')],
  ])('rejects a %s rate', (_name, body) => {
    expect(parseTgjuRate(body)).toBeNull();
  });
});

describe('createRialRateProvider', () => {
  it('applies the fee and caches for refreshMinutes', async () => {
    const { provider, fetchMock, advance } = setup();
    const first = await provider.getRate();
    expect(first).toEqual({
      ok: true,
      value: {
        marketRate: 2_695_000,
        feePercent: 20,
        rate: 3_234_000,
        source: 'tgju',
        updatedAt: '2026-10-25T15:57:58.000Z',
        stale: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      TGJU_RATE_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
      }),
    );
    advance(59 * 60_000);
    await provider.getRate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2 * 60_000);
    await provider.getRate();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const { provider, fetchMock } = setup();
    const results = await Promise.all([provider.getRate(), provider.getRate(), provider.getRate()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('serves the last good rate as stale after a failure and retries at most once a minute', async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getRate();
    advance(61 * 60_000);
    fetchMock.mockResolvedValue(jsonResponse('<html>blocked secret</html>', 503));

    const stale = await provider.getRate();
    expect(stale).toMatchObject({ ok: true, value: { rate: 3_234_000, stale: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('secret');

    advance(30_000);
    await provider.getRate();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    advance(31_000);
    fetchMock.mockResolvedValue(jsonResponse(payload('2,700,000')));
    const fresh = await provider.getRate();
    expect(fresh).toMatchObject({ ok: true, value: { marketRate: 2_700_000, stale: false } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats an implausible payload as a failure', async () => {
    const { provider, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse(payload('12')));
    expect(await provider.getRate()).toEqual({
      ok: false,
      error: { code: 'rial_rate_unavailable' },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected payload'));
  });

  it('falls back to fixedRate before the first success', async () => {
    const { provider, fetchMock } = setup({ fixedRate: 2_500_000 });
    fetchMock.mockRejectedValue(new TypeError('fetch failed: getaddrinfo secret-host'));
    const result = await provider.getRate();
    expect(result).toMatchObject({
      ok: true,
      value: { marketRate: 2_500_000, rate: 3_000_000, source: 'fixed', stale: false },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'));
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('secret-host');
  });

  it('aborts a hung fetch after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { provider, fetchMock } = setup();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = provider.getRate();
      await jest.advanceTimersByTimeAsync(8_000);
      expect(await pending).toEqual({ ok: false, error: { code: 'rial_rate_unavailable' } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('never fetches for the fixed source', async () => {
    const { provider, fetchMock } = setup({
      source: 'fixed',
      fixedRate: 2_000_000,
      feePercent: 10,
    });
    expect(await provider.getRate()).toMatchObject({
      ok: true,
      value: { rate: 2_200_000, source: 'fixed' },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const none = setup({ source: 'fixed' });
    expect(await none.provider.getRate()).toEqual({
      ok: false,
      error: { code: 'rial_rate_unavailable' },
    });
  });
});

describe('createRialRateRegistry', () => {
  it('returns null when rial pricing is off and shares a provider per config', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(payload()));
    const registry = createRialRateRegistry({ fetch: fetchMock as unknown as typeof fetch });
    expect(await registry.getRate(undefined)).toBeNull();
    expect(await registry.getRate({ enabled: false })).toBeNull();
    expect(await registry.getRate({ enabled: true, feePercent: -5 })).toBeNull();

    await registry.getRate({ enabled: true });
    await registry.getRate({ enabled: true, roundTo: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await registry.getRate({ enabled: true, feePercent: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/** Live check against tgju; run with `RIAL_LIVE=1 npx jest src/billing/rial.spec.ts`. */
(process.env.RIAL_LIVE === '1' ? describe : describe.skip)('live tgju feed', () => {
  it('reads a plausible rate', async () => {
    const provider = createRialRateProvider({ config: config(), fetch });
    const result = await provider.getRate();
    console.log(JSON.stringify(result));
    expect(result.ok).toBe(true);
  }, 15_000);
});
