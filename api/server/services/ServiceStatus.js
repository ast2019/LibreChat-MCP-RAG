const api = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { getAppConfig } = require('./Config');
const db = require('~/models');

const { standardCache, getProviderHttp, createWebSearchChainStore, createServiceStatusService } =
  api;

/** Web search failover state and the status snapshot, shared by replicas through Redis. */
const chainCache = standardCache('web_search_chain');
const statusCache = standardCache('service_status');

/** @param {import('librechat-data-provider').TCustomConfig['webSearch']} [webSearch] */
const getWebSearchChainStore = (webSearch) => createWebSearchChainStore(chainCache, webSearch);

/** Owner lookup and OAuth-token check behind the Higgsfield status. */
const higgsfieldStatusDeps = {
  findUserIdByEmail: async (email) => {
    const user = await db.findUser({ email }, '_id');
    return user?._id ? user._id.toString() : null;
  },
  hasMcpConnection: async (userId, serverName) =>
    Boolean(await db.findToken({ userId, type: 'mcp_oauth', identifier: `mcp:${serverName}` })),
};

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
    getHiggsfieldStatus: async () =>
      api.getHiggsfieldStatus(await getAppConfig({ role: SystemRoles.USER }), higgsfieldStatusDeps),
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

module.exports = {
  higgsfieldStatusDeps,
  getServiceStatus,
  getWebSearchChainStore,
  startServiceStatusRefresh,
};
