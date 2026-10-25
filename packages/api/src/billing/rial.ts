import { logger } from '@librechat/data-schemas';
import { CREDITS_PER_USD, balanceRialSchema } from 'librechat-data-provider';
import type { TBalanceRialConfig } from 'librechat-data-provider';

/** tgju.org's live price feed; `current.price_dollar_rl.p` is the free-market dollar in rial. */
export const TGJU_RATE_URL = 'https://call1.tgju.org/ajax.json';

const FETCH_TIMEOUT_MS = 8_000;
/** After a failed refresh, wait this long before trying again. */
const RETRY_AFTER_FAILURE_MS = 60_000;
const MIN_RATE = 10_000;
const MAX_RATE = 1_000_000_000;
/** tgju publishes Tehran wall-clock time; Iran has kept UTC+03:30 all year since 2022. */
const TEHRAN_OFFSET = '+03:30';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type RialRateSource = TBalanceRialConfig['source'];

export interface RialRate {
  /** Market rial per USD before the fee */
  marketRate: number;
  feePercent: number;
  /** Rial per USD including the fee */
  rate: number;
  source: RialRateSource;
  /** ISO time the market rate was published (tgju) or read */
  updatedAt: string;
  /** True when the latest refresh failed and an older rate is being served */
  stale: boolean;
}

export type RialRateResult =
  | { ok: true; value: RialRate }
  | { ok: false; error: { code: 'rial_rate_unavailable' } };

export interface RialRateProvider {
  getRate: () => Promise<RialRateResult>;
}

export interface RialRateProviderDeps {
  config: TBalanceRialConfig;
  fetch: typeof fetch;
  now?: () => number;
}

/** Credits (micro-dollars of billed usage) as US dollars. */
export function creditsToUsd(credits: number): number {
  return Number.isFinite(credits) ? credits / CREDITS_PER_USD : 0;
}

/** The rial price of `credits` at `rate` rial per USD, rounded up to a multiple of `roundTo`. */
export function priceInRial(credits: number, rate: number, roundTo: number): number {
  const step = Number.isFinite(roundTo) && roundTo >= 1 ? roundTo : 1;
  const raw = creditsToUsd(credits) * rate;
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  /** The epsilon keeps a float like 6470000.0000001 from rounding up a whole extra step */
  return Math.ceil(raw / step - 1e-9) * step;
}

function isValidRate(value: number): boolean {
  return Number.isFinite(value) && value > MIN_RATE && value < MAX_RATE;
}

function parseTehranTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const time = Date.parse(`${value.replace(' ', 'T')}${TEHRAN_OFFSET}`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Reads the market USD rate from a tgju `ajax.json` payload; null when it is missing or implausible. */
export function parseTgjuRate(
  payload: unknown,
): { marketRate: number; updatedAt: string | null } | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const current = (payload as { current?: unknown }).current;
  if (current == null || typeof current !== 'object') {
    return null;
  }
  const dollar = (current as { price_dollar_rl?: unknown }).price_dollar_rl;
  if (dollar == null || typeof dollar !== 'object') {
    return null;
  }
  const { p, ts } = dollar as { p?: unknown; ts?: unknown };
  const raw = typeof p === 'number' ? String(p) : p;
  if (typeof raw !== 'string' || !/^\s*[\d,]+(\.\d+)?\s*$/.test(raw)) {
    return null;
  }
  const marketRate = Number(raw.replace(/[,\s]/g, ''));
  if (!isValidRate(marketRate)) {
    return null;
  }
  return { marketRate, updatedAt: parseTehranTime(ts) };
}

/** Only our own summary or the error class, never upstream text that could echo a body. */
function failureReason(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return 'timeout';
  }
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  return /^(HTTP \d+|unexpected payload)$/.test(error.message) ? error.message : error.name;
}

interface CachedRate {
  marketRate: number;
  updatedAt: string;
  fetchedAt: number;
}

/**
 * Serves the USD to rial rate with the configured fee. A fetched rate is reused for
 * `refreshMinutes`; when a refresh fails the last good rate keeps being served as stale and
 * the feed is retried at most once a minute. Before any success, `fixedRate` (if set) stands in.
 */
export function createRialRateProvider(deps: RialRateProviderDeps): RialRateProvider {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const refreshMs = config.refreshMinutes * 60_000;
  let cached: CachedRate | null = null;
  let lastFailureAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  const withFee = (marketRate: number, source: RialRateSource, updatedAt: string, stale: boolean) =>
    ({
      ok: true,
      value: {
        marketRate,
        feePercent: config.feePercent,
        rate: Math.round(marketRate * (1 + config.feePercent / 100)),
        source,
        updatedAt,
        stale,
      },
    }) as const;

  const fallback = (): RialRateResult => {
    if (cached != null) {
      return withFee(cached.marketRate, 'tgju', cached.updatedAt, true);
    }
    if (config.fixedRate != null && isValidRate(config.fixedRate)) {
      return withFee(config.fixedRate, 'fixed', new Date(now()).toISOString(), false);
    }
    return { ok: false, error: { code: 'rial_rate_unavailable' } };
  };

  async function refresh(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await deps.fetch(TGJU_RATE_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const parsed = parseTgjuRate(await response.json());
      if (parsed == null) {
        throw new Error('unexpected payload');
      }
      const fetchedAt = now();
      cached = {
        marketRate: parsed.marketRate,
        updatedAt: parsed.updatedAt ?? new Date(fetchedAt).toISOString(),
        fetchedAt,
      };
      lastFailureAt = null;
    } catch (error) {
      lastFailureAt = now();
      logger.warn(
        `[rial] Couldn't refresh the USD rate from tgju: ${failureReason(error, controller.signal)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getRate(): Promise<RialRateResult> {
    if (config.source === 'fixed') {
      return fallback();
    }
    if (cached != null && now() - cached.fetchedAt < refreshMs) {
      return withFee(cached.marketRate, 'tgju', cached.updatedAt, false);
    }
    if (lastFailureAt != null && now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) {
      return fallback();
    }
    if (inFlight == null) {
      inFlight = refresh().finally(() => {
        inFlight = null;
      });
    }
    await inFlight;
    if (cached != null && now() - cached.fetchedAt < refreshMs) {
      return withFee(cached.marketRate, 'tgju', cached.updatedAt, false);
    }
    return fallback();
  }

  return { getRate };
}

export interface RialRateRegistry {
  /** The rate for this rial config; null when rial pricing is off or the config is invalid. */
  getRate: (config: unknown) => Promise<RialRateResult | null>;
}

/**
 * One rate provider per distinct rial config, so tenants sharing a config share a cache.
 * Create one registry at startup and hand it to every handler that prices packs.
 */
export function createRialRateRegistry(deps: {
  fetch: typeof fetch;
  now?: () => number;
}): RialRateRegistry {
  const providers = new Map<string, RialRateProvider>();
  return {
    async getRate(input) {
      if (input == null) {
        return null;
      }
      const parsed = balanceRialSchema.safeParse(input);
      if (!parsed.success || parsed.data.enabled !== true) {
        return null;
      }
      const config = parsed.data;
      const key = JSON.stringify([
        config.source,
        config.fixedRate ?? null,
        config.feePercent,
        config.refreshMinutes,
      ]);
      let provider = providers.get(key);
      if (provider == null) {
        provider = createRialRateProvider({ config, fetch: deps.fetch, now: deps.now });
        providers.set(key, provider);
      }
      return provider.getRate();
    },
  };
}
