const { createDebugMode, installDebugCapture, standardCache } = require('@librechat/api');
const db = require('~/models');

/**
 * Debug mode (admin «دیباگ»): its switch in the shared cache (Redis when the deployment has
 * it, so every replica sees one switch), traces in the `DebugTrace` collection and this
 * process's recent log lines. Behavior lives in `@librechat/api`.
 */
const STATE_KEY = 'state';
let cache;
const getCache = () => {
  if (!cache) {
    cache = standardCache('debug_mode');
  }
  return cache;
};

const debugMode = createDebugMode({
  store: {
    get: () => getCache().get(STATE_KEY),
    set: async (value, ttlMs) => {
      await getCache().set(STATE_KEY, value, ttlMs);
    },
    delete: async () => {
      await getCache().delete(STATE_KEY);
    },
  },
});

const debugTraces = {
  appendDebugTrace: (input) => db.appendDebugTrace(input),
  listDebugTraces: (params) => db.listDebugTraces(params),
  getDebugTrace: (traceId) => db.getDebugTrace(traceId),
  clearDebugTraces: () => db.clearDebugTraces(),
};

let capture;
/** Adds the log capture once; called at startup and by the admin route. */
const getDebugCapture = () => {
  if (!capture) {
    capture = installDebugCapture(debugMode);
  }
  return capture;
};

const getSystemLog = () => getDebugCapture().buffer.snapshot();

module.exports = { debugMode, debugTraces, getDebugCapture, getSystemLog };
