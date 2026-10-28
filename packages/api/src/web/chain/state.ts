import type { TSearchChainProvider } from 'librechat-data-provider';
import type { ProviderFailure, ProviderSkip } from './types';

/** The Keyv subset the chain state needs; the caller passes a shared (Redis-backed) cache. */
export interface ChainCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export interface ChainCooldowns {
  exhaustedCooldownSeconds: number;
  rateLimitCooldownSeconds: number;
  unauthorizedCooldownSeconds: number;
}

/** An exhausted provider with a known reset is skipped until then, but never longer than this. */
const MAX_RESET_WAIT_MS = 31 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const skipKey = (provider: TSearchChainProvider) => `skip:${provider}`;
const resetKey = (provider: TSearchChainProvider) => `reset:${provider}`;
const usageKey = (provider: TSearchChainProvider, day: string) => `usage:${provider}:${day}`;
const ACTIVE_KEY = 'active';

export const dayKey = (at: number): string => new Date(at).toISOString().slice(0, 10);

function isSkip(value: unknown): value is ProviderSkip {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const skip = value as Partial<ProviderSkip>;
  return typeof skip.until === 'number' && typeof skip.reason === 'string';
}

export interface ChainStateStore {
  getSkip(provider: TSearchChainProvider, now?: number): Promise<ProviderSkip | null>;
  /** Records a failure that takes the provider out of the chain; transient failures are ignored. */
  markFailure(
    provider: TSearchChainProvider,
    failure: ProviderFailure,
    now?: number,
  ): Promise<ProviderSkip | null>;
  clearSkip(provider: TSearchChainProvider): Promise<void>;
  /** When the provider's quota resets (from its account API), used for the exhaustion window. */
  setResetHint(provider: TSearchChainProvider, resetAt: number | null): Promise<void>;
  recordServed(provider: TSearchChainProvider, now?: number): Promise<void>;
  getActive(): Promise<{ provider: TSearchChainProvider; at: number } | null>;
  /** Searches the chain sent to the provider per UTC day, oldest first. */
  getDailyUsage(provider: TSearchChainProvider, days: number, now?: number): Promise<number[]>;
}

/**
 * Failover state shared by every replica through the caller's cache: which providers are being
 * skipped and until when, which one answered last, and per-day request counts. Counts use a
 * read-then-write, so concurrent replicas may undercount slightly; they only feed an estimate.
 */
export function createChainStateStore(
  cache: ChainCache,
  cooldowns: ChainCooldowns,
  historyDays = 30,
): ChainStateStore {
  const getSkip: ChainStateStore['getSkip'] = async (provider, now = Date.now()) => {
    const value = await cache.get(skipKey(provider));
    if (!isSkip(value) || value.until <= now) {
      return null;
    }
    return value;
  };

  const getResetHint = async (provider: TSearchChainProvider): Promise<number | null> => {
    const value = await cache.get(resetKey(provider));
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  return {
    getSkip,
    async markFailure(provider, failure, now = Date.now()) {
      if (failure.kind === 'transient' || failure.kind === 'invalid') {
        return null;
      }
      let until: number;
      if (failure.kind === 'rate_limited') {
        until = now + (failure.retryAfterSeconds ?? cooldowns.rateLimitCooldownSeconds) * 1000;
      } else if (failure.kind === 'unauthorized') {
        until = now + cooldowns.unauthorizedCooldownSeconds * 1000;
      } else {
        const reset = await getResetHint(provider);
        until =
          reset != null && reset > now && reset - now <= MAX_RESET_WAIT_MS
            ? reset
            : now + cooldowns.exhaustedCooldownSeconds * 1000;
      }
      const skip: ProviderSkip = { reason: failure.kind, until, code: failure.code };
      await cache.set(skipKey(provider), skip, Math.max(1000, until - now));
      return skip;
    },
    async clearSkip(provider) {
      await cache.delete(skipKey(provider));
    },
    async setResetHint(provider, resetAt) {
      if (resetAt == null) {
        await cache.delete(resetKey(provider));
        return;
      }
      await cache.set(resetKey(provider), resetAt, MAX_RESET_WAIT_MS);
    },
    async recordServed(provider, now = Date.now()) {
      const key = usageKey(provider, dayKey(now));
      const current = await cache.get(key);
      const count = typeof current === 'number' ? current : 0;
      await Promise.all([
        cache.set(key, count + 1, historyDays * DAY_MS),
        cache.set(ACTIVE_KEY, { provider, at: now }),
      ]);
    },
    async getActive() {
      const value = await cache.get(ACTIVE_KEY);
      if (typeof value !== 'object' || value === null) {
        return null;
      }
      const active = value as { provider?: TSearchChainProvider; at?: number };
      return active.provider != null && typeof active.at === 'number'
        ? { provider: active.provider, at: active.at }
        : null;
    },
    async getDailyUsage(provider, days, now = Date.now()) {
      const keys = Array.from({ length: days }, (_, index) =>
        usageKey(provider, dayKey(now - (days - 1 - index) * DAY_MS)),
      );
      const values = await Promise.all(keys.map((key) => cache.get(key)));
      return values.map((value) => (typeof value === 'number' ? value : 0));
    },
  };
}
