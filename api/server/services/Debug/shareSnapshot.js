const {
  resolveAppReleaseInfo,
  getBrowserStartupConfig,
  selectShareLogLines,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

/**
 * Sanitized diagnostics for AI paste codes: versions, service health and this process's recent
 * log lines (warnings and errors always; every line at the chosen level while debug mode is
 * on), redacted again for sharing. Never includes secrets, tokens, emails or full IPs.
 * @returns {Promise<object>}
 */
async function buildDebugShareSnapshot() {
  const notes = [
    'Sanitized HiveGPT diagnostics. No secrets, JWT keys, bridge admin tokens, emails or full IPs.',
    'The link is rebuilt on every open, so it shows lines logged after it was made.',
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
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
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
    // AppConfig keeps librechat.yaml under `config`; top-level `browser` is only an
    // admin override. getBrowserStartupConfig reads both and requires BROWSER_SERVICE_*.
    browser = {
      ...getBrowserStartupConfig(config),
      openSessions: null,
    };
  } catch {
    notes.push('Could not load app config for attach/browser summary.');
  }

  let logs;
  try {
    const { debugMode: mode, getSystemLog, getProblemLog } = require('~/server/services/Debug');
    const state = await mode.getState();
    debugMode = { enabled: state.enabled === true, ...(state.level && { level: state.level }) };
    logs = selectShareLogLines({
      debug: getSystemLog().lines,
      problems: getProblemLog().lines,
    });
    if (!debugMode.enabled) {
      notes.push(
        'Debug mode is off: only warnings and errors are included. Turn it on (level info or debug), reproduce the problem, then open this link again for every line.',
      );
    }
    if (logs.lines.length === 0) {
      notes.push(
        'No log lines in the window yet: reproduce the problem, then open this link again.',
      );
    }
  } catch {
    notes.push('Could not read the log lines of this process.');
  }

  return {
    ...(appVersion && { appVersion }),
    ...(librechatVersion && { librechatVersion }),
    ...(Object.keys(build).length > 0 && { build }),
    codeBridge,
    attach,
    browser,
    debugMode,
    ...(logs && { logs }),
    notes,
  };
}

module.exports = { buildDebugShareSnapshot };
