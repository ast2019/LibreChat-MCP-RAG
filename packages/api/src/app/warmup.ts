import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { CurrencyRates, InterfaceCurrency } from '~/billing/currency';
import type { ModelCatalogue } from '~/modelSpecs/catalogue';
import type { FetchModelsParams } from '~/endpoints/models';
import type { ServerRequest } from '~/types';
import { getSharedModelCatalogue, resolveModelCatalogueSource } from '~/modelSpecs/catalogue';
import { createLoadConfigModels } from '~/endpoints/config/models';
import { getSharedCurrencyRates } from '~/billing/currency';
import { describePasskeyStatus } from '~/auth/passkey';

export interface WarmStartupCachesDeps {
  /** Override for tests; defaults to the shared `fetchModels` */
  fetchModels?: (params: FetchModelsParams) => Promise<string[]>;
  /** Override for tests; defaults to the process-wide live-rate cache */
  currencyRates?: CurrencyRates;
  /** Override for tests; defaults to the process-wide model catalogue */
  modelCatalogue?: ModelCatalogue;
}

const HOUR_MS = 3_600_000;
/** setInterval's ceiling (~24.8 days); a longer delay would fire immediately */
const MAX_INTERVAL_MS = 2_147_483_647;

/**
 * Fills the caches the first page load waits on, so the first user after a restart does not
 * pay for them:
 * - the custom endpoints' fetched model lists (and the provider prices they carry), via the
 *   same `loadConfigModels` path `/api/models` uses — without a user, so only endpoints with an
 *   admin-configured key and base URL are fetched;
 * - the live currency rate `/api/config` reports;
 * - the model catalogue `modelSpecs.autoDiscover` reads, which then refreshes itself every
 *   `refreshHours` from the same source (the base config's endpoint at startup).
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

  const passkeys = describePasskeyStatus();
  logger[passkeys.level](passkeys.message);

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

  const warmCatalogue = async () => {
    const settings = appConfig.modelSpecs?.autoDiscover;
    if (settings?.enabled !== true) {
      return;
    }
    const source = resolveModelCatalogueSource(appConfig);
    if (!source) {
      logger.warn(
        `[warmStartupCaches] modelSpecs.autoDiscover: endpoint "${settings.endpoint ?? ''}" has no usable base URL; no models will be discovered`,
      );
      return;
    }
    const hours = settings.refreshHours ?? 6;
    const intervalMs = Math.min(Math.max(hours * HOUR_MS, 60_000), MAX_INTERVAL_MS);
    const catalogue = deps.modelCatalogue ?? getSharedModelCatalogue();
    await catalogue.start(source, intervalMs);
  };

  return Promise.allSettled([warmModels(), warmCurrency(), warmCatalogue()]).then((results) => {
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
