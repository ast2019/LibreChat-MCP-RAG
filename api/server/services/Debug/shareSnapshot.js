const { resolveAppReleaseInfo } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

/**
 * Sanitized diagnostics for AI paste codes. Never includes secrets, tokens, or raw logs.
 * @returns {Promise<object>}
 */
async function buildDebugShareSnapshot() {
  const notes = [
    'Sanitized HiveGPT diagnostics. No secrets, JWT keys, or bridge admin tokens.',
    'Admin Debug panel and Browser log UIs remain the interactive sources of truth.',
  ];

  let appVersion;
  let librechatVersion;
  try {
    const release = resolveAppReleaseInfo(1);
    appVersion = release.appVersion;
    librechatVersion = release.librechatVersion;
  } catch {
    notes.push('Could not resolve VERSION/CHANGELOG from disk.');
  }

  const build = {
    ...(process.env.BUILD_COMMIT && { commit: process.env.BUILD_COMMIT }),
    ...(process.env.BUILD_BRANCH && { branch: process.env.BUILD_BRANCH }),
    ...(process.env.BUILD_DATE && { date: process.env.BUILD_DATE }),
  };

  let codeBridge = { configured: false };
  let attach = {};
  let browser = { enabled: false, openSessions: null };
  let debugMode = { enabled: false };

  try {
    const config = await getAppConfig({ baseOnly: true });
    const sessions = config?.endpoints?.agents?.statefulCodeSessions;
    const envs = sessions?.environments ?? [];
    const bridgeUrl =
      process.env.LIBRECHAT_CODE_BRIDGE_BASEURL ||
      envs.find((item) => item?.type === 'attached')?.baseURL ||
      '';
    attach = {
      principalWorkersEnabled: sessions?.principalWorkers?.enabled === true,
      maxPerUser: sessions?.principalWorkers?.maxPerUser,
      environmentsConfigured: Array.isArray(envs) ? envs.length : 0,
    };
    codeBridge = { configured: typeof bridgeUrl === 'string' && bridgeUrl.startsWith('https://') };
    if (codeBridge.configured) {
      const healthUrl = `${bridgeUrl.replace(/\/$/, '')}/health`;
      try {
        const response = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
        codeBridge = {
          ...codeBridge,
          healthOk: response.ok,
          statusCode: response.status,
        };
      } catch {
        codeBridge = { ...codeBridge, healthOk: false };
        notes.push('Code bridge health probe failed from the api container.');
      }
    }
    browser = {
      enabled: config?.browser?.enabled === true,
      openSessions: null,
    };
  } catch {
    notes.push('Could not load app config for attach/browser summary.');
  }

  try {
    const { debugMode: mode } = require('~/server/services/Debug');
    const state = await mode.getState();
    debugMode = { enabled: state.enabled === true, ...(state.level && { level: state.level }) };
  } catch {
    /* optional */
  }

  return {
    ...(appVersion && { appVersion }),
    ...(librechatVersion && { librechatVersion }),
    ...(Object.keys(build).length > 0 && { build }),
    codeBridge,
    attach,
    browser,
    debugMode,
    notes,
  };
}

module.exports = { buildDebugShareSnapshot };
