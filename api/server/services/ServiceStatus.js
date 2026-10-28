const api = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('./Config');

const { standardCache, getProviderHttp, createWebSearchChainStore, createServiceStatusService } =
  api;

/** Web search failover state and the status snapshot, shared by replicas through Redis. */
const chainCache = standardCache('web_search_chain');
const statusCache = standardCache('service_status');

/** @param {import('librechat-data-provider').TCustomConfig['webSearch']} [webSearch] */
const getWebSearchChainStore = (webSearch) => createWebSearchChainStore(chainCache, webSearch);

/** Kavenegar's balance; `null` (not set up) without `KAVENEGAR_API_KEY`. */
const getSmsBalance = () => api.readKavenegarBalance(process.env);

let service;
const getServiceStatus = () => {
  service ??= createServiceStatusService({
    cache: statusCache,
    chainStore: getWebSearchChainStore(),
    http: getProviderHttp(),
    logger,
    getSmsBalance,
    getPaymentGatewaysStatus: async () =>
      api.getPaymentGatewaysStatus(await getAppConfig({ baseOnly: true })),
    loadConfig: async () => {
      const appConfig = await getAppConfig({ baseOnly: true });
      return { webSearch: appConfig?.webSearch, serviceStatus: appConfig?.config?.serviceStatus };
    },
  });
  return service;
};

const startServiceStatusRefresh = () =>
  getServiceStatus()
    .start()
    .catch((error) =>
      logger.error('[serviceStatus] Could not start the background refresh', error),
    );

module.exports = { getServiceStatus, getWebSearchChainStore, startServiceStatusRefresh };
