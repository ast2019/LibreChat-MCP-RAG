import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import type { CurrencyRates, InterfaceCurrency } from '~/billing/currency';
import type { FetchModelsParams } from '~/endpoints/models';
import { getSharedCurrencyRates } from '~/billing/currency';
import { createLoadConfigModels } from '~/endpoints/config/models';

export interface WarmStartupCachesDeps {
  /** Override for tests; defaults to the shared `fetchModels` */
  fetchModels?: (params: FetchModelsParams) => Promise<string[]>;
  /** Override for tests; defaults to the process-wide live-rate cache */
  currencyRates?: CurrencyRates;
}

/**
 * Fills the caches the first page load waits on, so the first user after a restart does not
 * pay for them:
 * - the custom endpoints' fetched model lists (and the provider prices they carry), via the
 *   same `loadConfigModels` path `/api/models` uses — without a user, so only endpoints with an
 *   admin-configured key and base URL are fetched;
 * - the live currency rate `/api/config` reports.
 *
 * Fire-and-forget: never throws and never blocks the caller.
 */
export function warmStartupCaches(
  { appConfig }: { appConfig?: AppConfig | null },
  deps: WarmStartupCachesDeps = {},
): Promise<void> {
  if (!appConfig) {
    return Promise.resolve();
  }

  const warmModels = async () => {
    const loadConfigModels = createLoadConfigModels({
      getAppConfig: async () => appConfig,
      /** Never consulted: user-provided keys are only resolved for a request with a user */
      getUserKeyValues: async () => {
        throw new Error('No user during startup warm-up');
      },
      ...(deps.fetchModels && { fetchModels: deps.fetchModels }),
    });
    const started = Date.now();
    const modelsConfig = await loadConfigModels({ config: appConfig } as unknown as ServerRequest);
    logger.info(
      `[warmStartupCaches] Model lists ready for ${Object.keys(modelsConfig).length} endpoint(s) in ${Date.now() - started}ms`,
    );
  };

  const warmCurrency = async () => {
    const rates = deps.currencyRates ?? getSharedCurrencyRates();
    await rates.resolve(appConfig.interfaceConfig?.currency as InterfaceCurrency | undefined);
  };

  return Promise.allSettled([warmModels(), warmCurrency()]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn(
          '[warmStartupCaches] Cache warm-up failed (requests will fill it):',
          result.reason,
        );
      }
    }
  });
}
