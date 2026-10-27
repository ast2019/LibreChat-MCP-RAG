import type { MarketRate, RateFetcher } from './currency';
import { createCurrencyRates, createTgjuFetcher, parseTgjuRate } from './currency';

const tgjuBody = (p: unknown, ts = '2026-10-25 19:59:59') => ({
  current: { price_dollar_rl: { p, ts } },
});

const toman = {
  code: 'IRT',
  rate: 270000,
  priceStep: 1000,
  live: { source: 'tgju' as const, refreshMinutes: 30 },
};

describe('parseTgjuRate', () => {
  it('reads the comma-grouped rial price and converts the Tehran timestamp', () => {
    expect(parseTgjuRate(tgjuBody('2,695,000'))).toEqual({
      rialsPerUsd: 2695000,
      updatedAt: '2026-10-25T16:29:59.000Z',
    });
  });

  it('rejects a missing, non-numeric or implausible price', () => {
    expect(() => parseTgjuRate({})).toThrow();
    expect(() => parseTgjuRate(tgjuBody('n/a'))).toThrow();
    expect(() => parseTgjuRate(tgjuBody('0'))).toThrow();
  });

  it('omits an unreadable timestamp', () => {
    expect(parseTgjuRate(tgjuBody('2,695,000', 'yesterday')).updatedAt).toBeUndefined();
  });
});

describe('createTgjuFetcher', () => {
  it('falls through to the next mirror when one fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => tgjuBody('2,700,000') });
    const fetcher = createTgjuFetcher(fetchImpl as unknown as typeof fetch, ['a', 'b']);
    await expect(fetcher(new AbortController().signal)).resolves.toEqual(
      expect.objectContaining({ rialsPerUsd: 2700000 }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws once every mirror failed', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
    const fetcher = createTgjuFetcher(fetchImpl as unknown as typeof fetch, ['a', 'b']);
    await expect(fetcher(new AbortController().signal)).rejects.toThrow('offline');
  });
});

describe('createCurrencyRates', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  const reading = (rialsPerUsd: number): MarketRate => ({
    rialsPerUsd,
    updatedAt: '2026-10-25T16:29:59.000Z',
  });

  it('returns no currency when none is configured or it is incomplete', async () => {
    const rates = createCurrencyRates({ fetchers: {}, now });
    await expect(rates.resolve(undefined)).resolves.toEqual({});
    await expect(rates.resolve({ code: 'IRT' })).resolves.toEqual({});
  });

  it('uses the yaml rate when no live source is set', async () => {
    const rates = createCurrencyRates({ fetchers: {}, now });
    await expect(rates.resolve({ code: 'EUR', rate: 0.9 })).resolves.toEqual({
      currency: { code: 'EUR', rate: 0.9 },
      info: { source: 'config' },
    });
  });

  it('converts the live rial price to Toman and keeps the price step', async () => {
    const fetcher: RateFetcher = jest.fn().mockResolvedValue(reading(2695000));
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now, firstReadWaitMs: 1500 });
    await expect(rates.resolve(toman)).resolves.toEqual({
      currency: { code: 'IRT', rate: 269500, priceStep: 1000 },
      info: { source: 'tgju', updatedAt: '2026-10-25T16:29:59.000Z' },
    });
    await expect(rates.resolve({ ...toman, code: 'IRR' })).resolves.toEqual(
      expect.objectContaining({ currency: { code: 'IRR', rate: 2695000, priceStep: 1000 } }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves the cached reading, then refreshes in the background once it is stale', async () => {
    const fetcher = jest
      .fn<Promise<MarketRate>, [AbortSignal]>()
      .mockResolvedValueOnce(reading(2695000))
      .mockResolvedValueOnce(reading(2800000));
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now, firstReadWaitMs: 1500 });
    await rates.resolve(toman);

    clock += 31 * 60_000;
    const stale = await rates.resolve(toman);
    expect(stale.currency?.rate).toBe(269500);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await new Promise((resolve) => setImmediate(resolve));
    const fresh = await rates.resolve(toman);
    expect(fresh.currency?.rate).toBe(280000);
  });

  it('falls back to the yaml rate before any reading and backs off after a failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('blocked'));
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now, retryMs: 60_000 });

    await expect(rates.resolve(toman)).resolves.toEqual({
      currency: { code: 'IRT', rate: 270000, priceStep: 1000 },
      info: { source: 'config' },
    });
    await rates.resolve(toman);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 61_000;
    await rates.resolve(toman);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good reading when a refresh fails', async () => {
    const fetcher = jest
      .fn<Promise<MarketRate>, [AbortSignal]>()
      .mockResolvedValueOnce(reading(2695000))
      .mockRejectedValueOnce(new Error('timeout'));
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now, firstReadWaitMs: 1500 });
    await rates.resolve(toman);
    clock += 31 * 60_000;
    await rates.resolve(toman);
    await new Promise((resolve) => setImmediate(resolve));
    const after = await rates.resolve(toman);
    expect(after.currency?.rate).toBe(269500);
    expect(after.info?.source).toBe('tgju');
  });

  it('never waits for the first reading by default, then serves it once it lands', async () => {
    let settle: (value: MarketRate) => void = () => undefined;
    const fetcher = jest.fn<Promise<MarketRate>, [AbortSignal]>(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now });

    await expect(rates.resolve(toman)).resolves.toEqual({
      currency: { code: 'IRT', rate: 270000, priceStep: 1000 },
      info: { source: 'config' },
    });
    settle(reading(2695000));
    await new Promise((resolve) => setImmediate(resolve));
    await expect(rates.resolve(toman)).resolves.toEqual(
      expect.objectContaining({ currency: { code: 'IRT', rate: 269500, priceStep: 1000 } }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('waits only briefly for a slow first reading', async () => {
    const fetcher: RateFetcher = () => new Promise(() => undefined);
    const rates = createCurrencyRates({ fetchers: { tgju: fetcher }, now, firstReadWaitMs: 10 });
    await expect(rates.resolve(toman)).resolves.toEqual(
      expect.objectContaining({ info: { source: 'config' } }),
    );
  });
});
