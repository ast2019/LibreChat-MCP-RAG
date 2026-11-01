import {
  SystemRoles,
  findPackGrants,
  browserConfigSchema,
  resolveBrowserAccess,
  findPackBrowserSessions,
} from 'librechat-data-provider';
import type { TBrowserConfig, TEffectiveAccess } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getBalanceConfig, readConfigSection } from '~/app/config';

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
