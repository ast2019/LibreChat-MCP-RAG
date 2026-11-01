const { logger } = require('@librechat/data-schemas');
const {
  getBrowserService,
  createBrowserTools,
  createBrowserLogSync,
  createBrowserServiceClient,
} = require('@librechat/api');
const db = require('~/models');

/** The agent browser (experimental): the client of the `browser` service and its log sync. */
let client;
const getBrowserClient = () => {
  if (client === undefined) {
    const target = getBrowserService();
    client = target ? createBrowserServiceClient(target) : null;
  }
  return client;
};

/** The writes and reads the browser paths make in the `BrowserSession` log. */
const browserLog = {
  recordBrowserSessionStart: (input) => db.recordBrowserSessionStart(input),
  recordBrowserSessionEnd: (input) => db.recordBrowserSessionEnd(input),
  recordBrowserRefusal: (input) => db.recordBrowserRefusal(input),
  listOpenBrowserSessionIds: () => db.listOpenBrowserSessionIds(),
  listBrowserSessions: (params) => db.listBrowserSessions(params),
};

/** Copies the ends the service reports (idle, timeout, crash) into the log every 30 seconds. */
const startBrowserLogSync = () => {
  const browser = getBrowserClient();
  if (!browser) {
    logger.info('[browser] BROWSER_SERVICE_URL/TOKEN not set; the agent browser is off');
    return;
  }
  createBrowserLogSync({ client: browser, log: browserLog }).start();
};

/** The model's browser tools for one request; behavior lives in `@librechat/api`. */
const loadBrowserTools = (req, toolNames) =>
  createBrowserTools({ req, toolNames }, { getClient: getBrowserClient, log: browserLog });

module.exports = { getBrowserClient, browserLog, loadBrowserTools, startBrowserLogSync };
