import {
  SystemRoles,
  findPackGrants,
  BROWSER_TOOL_NAMES,
  browserConfigSchema,
  resolveBrowserAccess,
  findPackBrowserSessions,
} from 'librechat-data-provider';
import type {
  TModelSpec,
  TBrowserConfig,
  TEffectiveAccess,
  TBrowserStartupConfig,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getBalanceConfig, readConfigSection } from '~/app/config';
import { debugTrace } from '~/debug/recorder';

/** The deployment's `browser` settings; the defaults when the section is absent or invalid. */
export function getBrowserConfig(appConfig: AppConfig | null | undefined): TBrowserConfig {
  const parsed = browserConfigSchema.safeParse(readConfigSection(appConfig, 'browser') ?? {});
  return parsed.success ? parsed.data : browserConfigSchema.parse({});
}

export interface BrowserServiceTarget {
  url: string;
  token: string;
}

/**
 * Where the browser service listens and the token it expects, from `BROWSER_SERVICE_URL` and
 * `BROWSER_SERVICE_TOKEN`; null until both are set (the token needs 32 characters or more).
 */
export function getBrowserService(
  env: Record<string, string | undefined> = process.env,
): BrowserServiceTarget | null {
  const url = env.BROWSER_SERVICE_URL?.trim().replace(/\/+$/, '');
  const token = env.BROWSER_SERVICE_TOKEN?.trim();
  if (!url || !/^https?:\/\//.test(url) || !token || token.length < 32) {
    return null;
  }
  return { url, token };
}

export interface BrowserUser {
  id?: string;
  _id?: unknown;
  role?: string;
  browserAccess?: boolean;
  packId?: string;
}

export interface UserBrowserAccess extends TEffectiveAccess {
  /** Browsers this user may have open at once */
  sessions: number;
}

/**
 * Whether this user may open the agent browser and how many at once. Admins always may (the
 * owner's rule); others need their override or their current pack to include it.
 */
export function resolveUserBrowserAccess(
  user: BrowserUser | null | undefined,
  appConfig: AppConfig | null | undefined,
): UserBrowserAccess {
  const packs = getBalanceConfig(appConfig ?? undefined)?.packs;
  const access = resolveBrowserAccess({
    isAdmin: user?.role === SystemRoles.ADMIN,
    override: user?.browserAccess,
    packGrant: findPackGrants(packs, user?.packId)?.browser,
  });
  return { ...access, sessions: findPackBrowserSessions(packs, user?.packId) };
}

/** Whether the composer may offer the browser: on in the config, with the service set up. */
export function getBrowserStartupConfig(
  appConfig: AppConfig | null | undefined,
  env: Record<string, string | undefined> = process.env,
): TBrowserStartupConfig {
  return { enabled: getBrowserConfig(appConfig).enabled && getBrowserService(env) != null };
}

/**
 * The browser tools a chat gets when the user turned the browser on in the composer: none
 * unless the deployment has it, the user may use it, and the spec is not a confidential or
 * local one (whose conversations reach no third party).
 */
export function getChatBrowserTools(
  appConfig: AppConfig | null | undefined,
  user: BrowserUser | null | undefined,
  spec?: Pick<TModelSpec, 'privacy'> | null,
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (spec?.privacy === 'private' || spec?.privacy === 'local') {
    debugTrace('browser_gate', { result: 'refused', reason: `spec_${spec.privacy}` });
    return [];
  }
  if (!getBrowserStartupConfig(appConfig, env).enabled) {
    debugTrace('browser_gate', () => ({
      result: 'refused',
      reason: 'browser_off',
      configEnabled: getBrowserConfig(appConfig).enabled,
      serviceConfigured: getBrowserService(env) != null,
    }));
    return [];
  }
  const access = resolveUserBrowserAccess(user, appConfig);
  debugTrace('browser_gate', {
    result: access.allowed ? 'allowed' : 'refused',
    ...(!access.allowed && { reason: 'no_access' }),
    access,
  });
  return access.allowed ? [...BROWSER_TOOL_NAMES] : [];
}
