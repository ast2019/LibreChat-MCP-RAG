import { logger } from '@librechat/data-schemas';
import type { LiveCurrencySource, TCurrencyRateInfo } from 'librechat-data-provider';

/** `interface.currency` as the app config carries it: admin overrides merge in unvalidated,
 *  so every field is checked before use. */
export interface InterfaceCurrency {
  code?: string;
  rate?: number;
  live?: { source?: LiveCurrencySource; refreshMinutes?: number };
  priceStep?: number;
}

/** What the client formats amounts with: units of `code` per US dollar. */
export interface ResolvedCurrency {
  code: string;
  rate: number;
  priceStep?: number;
}

/** One reading of a market: Iranian rials per US dollar. */
export interface MarketRate {
  rialsPerUsd: number;
  /** ISO time the source published the price */
  updatedAt?: string;
}

export type RateFetcher = (signal: AbortSignal) => Promise<MarketRate>;

export const TGJU_URLS = [
  'https://call1.tgju.org/ajax.json',
  'https://call2.tgju.org/ajax.json',
  'https://call3.tgju.org/ajax.json',
] as const;

const DEFAULT_REFRESH_MINUTES = 30;
/** How long a request waits for the very first reading before it uses the yaml rate */
const DEFAULT_FIRST_READ_WAIT_MS = 1500;
const DEFAULT_TIMEOUT_MS = 8000;
/** A failed read is not retried sooner than this, so an outage costs one request per minute */
const DEFAULT_RETRY_MS = 60_000;
/** tgju publishes its timestamps in Tehran time, which has no daylight saving since 2022 */
const TEHRAN_OFFSET = '+03:30';

function toIsoTime(stamp: unknown): string | undefined {
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)) {
    return undefined;
  }
  const date = new Date(`${stamp.replace(' ', 'T')}${TEHRAN_OFFSET}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Reads the free-market dollar (`price_dollar_rl`, in rials) from tgju's `ajax.json`.
 * Throws when the field is missing or not a plausible price, so a changed format never
 * turns into a zero or absurd rate.
 */
export function parseTgjuRate(body: unknown): MarketRate {
  const entry = (body as { current?: { price_dollar_rl?: { p?: unknown; ts?: unknown } } })?.current
    ?.price_dollar_rl;
  const raw = typeof entry?.p === 'string' ? entry.p.replace(/,/g, '') : entry?.p;
  const rialsPerUsd = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof rialsPerUsd !== 'number' || !Number.isFinite(rialsPerUsd) || rialsPerUsd < 1000) {
    throw new Error('tgju: price_dollar_rl missing or invalid');
  }
  return { rialsPerUsd, updatedAt: toIsoTime(entry?.ts) };
}

/** Fetches tgju's mirrors in order until one answers with a valid price. */
export function createTgjuFetcher(
  fetchImpl: typeof fetch = globalThis.fetch,
  urls: readonly string[] = TGJU_URLS,
): RateFetcher {
  return async (signal) => {
    let lastError: unknown;
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, {
          signal,
          headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 HiveGPT' },
        });
        if (!response.ok) {
          throw new Error(`tgju: HTTP ${response.status}`);
        }
        return parseTgjuRate(await response.json());
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('tgju: no mirror answered');
  };
}

/** Rials per dollar in the configured unit; the Toman (IRT) is ten rials. */
function convert(rialsPerUsd: number, code: string): number {
  return code === 'IRT' ? rialsPerUsd / 10 : rialsPerUsd;
}

interface SourceState {
  value?: MarketRate;
  fetchedAt?: number;
  failedAt?: number;
  inflight?: Promise<MarketRate | undefined>;
}

export interface CurrencyRates {
  /**
   * The currency the client should format with and where its rate came from. A configured
   * live source answers from its last reading and refreshes in the background once that is
   * older than `refreshMinutes`; before the first reading, a request waits briefly and then
   * uses the yaml `rate`.
   */
  resolve(
    currency: InterfaceCurrency | undefined,
  ): Promise<{ currency?: ResolvedCurrency; info?: TCurrencyRateInfo }>;
}

export function createCurrencyRates({
  fetchers,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  firstReadWaitMs = DEFAULT_FIRST_READ_WAIT_MS,
  retryMs = DEFAULT_RETRY_MS,
}: {
  fetchers: Partial<Record<LiveCurrencySource, RateFetcher>>;
  now?: () => number;
  timeoutMs?: number;
  firstReadWaitMs?: number;
  retryMs?: number;
}): CurrencyRates {
  const states = new Map<LiveCurrencySource, SourceState>();

  const refresh = (source: LiveCurrencySource, state: SourceState) => {
    const fetcher = fetchers[source];
    if (fetcher == null) {
      return Promise.resolve(undefined);
    }
    state.inflight ??= (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const value = await fetcher(controller.signal);
        state.value = value;
        state.fetchedAt = now();
        state.failedAt = undefined;
        return value;
      } catch (error) {
        state.failedAt = now();
        logger.warn(`[currency] could not read the ${source} rate; keeping the last one`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      } finally {
        clearTimeout(timer);
        state.inflight = undefined;
      }
    })();
    return state.inflight;
  };

  const read = async (
    source: LiveCurrencySource,
    refreshMinutes: number,
  ): Promise<MarketRate | undefined> => {
    let state = states.get(source);
    if (state == null) {
      state = {};
      states.set(source, state);
    }
    const at = now();
    const fresh = state.fetchedAt != null && at - state.fetchedAt < refreshMinutes * 60_000;
    const backingOff = state.failedAt != null && at - state.failedAt < retryMs;
    if (!fresh && !backingOff) {
      const pending = refresh(source, state);
      if (state.value == null) {
        const waited = await Promise.race([
          pending,
          new Promise<undefined>((resolve) => {
            setTimeout(resolve, firstReadWaitMs);
          }),
        ]);
        return waited ?? state.value;
      }
    }
    return state.value;
  };

  return {
    async resolve(currency) {
      const code = currency?.code;
      const rate = currency?.rate;
      if (typeof code !== 'string' || code === '' || !(typeof rate === 'number' && rate > 0)) {
        return {};
      }
      const step = currency?.priceStep;
      const priceStep = typeof step === 'number' && step > 0 ? step : undefined;
      const fallback = {
        currency: { code, rate, ...(priceStep != null && { priceStep }) },
        info: { source: 'config' as const },
      };
      const source = currency?.live?.source;
      if (source == null || fetchers[source] == null) {
        return fallback;
      }
      const minutes = currency?.live?.refreshMinutes;
      const reading = await read(
        source,
        typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_REFRESH_MINUTES,
      );
      if (reading == null) {
        return fallback;
      }
      return {
        currency: {
          code,
          rate: convert(reading.rialsPerUsd, code),
          ...(priceStep != null && { priceStep }),
        },
        info: { source, ...(reading.updatedAt && { updatedAt: reading.updatedAt }) },
      };
    },
  };
}
