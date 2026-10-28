import type { TSearchChainProvider } from 'librechat-data-provider';
import type {
  ChainProvider,
  ChainSearchRequest,
  ProviderSkip,
  SerperShapedResponse,
} from './types';
import type { ChainStateStore } from './state';
import { SearchProviderError } from './types';

interface ChainLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ChainAttempt {
  provider: TSearchChainProvider;
  /** `skipped` when the provider was already out of the chain. */
  code: string;
}

/** Every provider was skipped or failed; `attempts` carries codes only, never provider text. */
export class SearchChainError extends Error {
  readonly code = 'search_chain_unavailable';
  readonly attempts: ChainAttempt[];

  constructor(attempts: ChainAttempt[]) {
    super(
      `No web search provider is available (${attempts.map((a) => `${a.provider}: ${a.code}`).join(', ') || 'none configured'})`,
    );
    this.name = 'SearchChainError';
    this.attempts = attempts;
  }
}

export interface SearchChain {
  readonly providers: readonly TSearchChainProvider[];
  search(
    request: ChainSearchRequest,
  ): Promise<{ provider: TSearchChainProvider; data: SerperShapedResponse }>;
}

/**
 * Tries providers in order. A provider the shared state is skipping is passed over; a quota,
 * rate-limit or key failure marks it skipped for every replica and the next provider answers;
 * a transient failure (5xx, timeout) moves only this request on. A cache outage never blocks a
 * search: the provider is tried as if it were not skipped.
 */
export function createSearchChain({
  providers,
  store,
  logger,
}: {
  providers: ChainProvider[];
  store: ChainStateStore;
  logger: ChainLogger;
}): SearchChain {
  const readSkip = (name: TSearchChainProvider): Promise<ProviderSkip | null> =>
    store.getSkip(name).catch((error: unknown) => {
      logger.error('[webSearch.chain] Could not read provider state', {
        provider: name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    });

  return {
    providers: providers.map((provider) => provider.name),
    async search(request) {
      const skips = await Promise.all(providers.map((provider) => readSkip(provider.name)));
      const attempts: ChainAttempt[] = [];
      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index];
        if (skips[index] != null) {
          attempts.push({ provider: provider.name, code: 'skipped' });
          continue;
        }
        try {
          const data = await provider.search(request);
          store.recordServed(provider.name).catch(() => undefined);
          return { provider: provider.name, data };
        } catch (error) {
          const failure =
            error instanceof SearchProviderError
              ? error.failure
              : { kind: 'transient' as const, code: 'unknown' };
          attempts.push({ provider: provider.name, code: failure.code });
          logger.warn('[webSearch.chain] Provider failed, trying the next one', {
            provider: provider.name,
            kind: failure.kind,
            code: failure.code,
          });
          await store.markFailure(provider.name, failure).catch(() => undefined);
        }
      }
      throw new SearchChainError(attempts);
    },
  };
}
