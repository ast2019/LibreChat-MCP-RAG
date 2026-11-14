import {
  SystemRoles,
  extractEnvVariable,
  resolveHiggsfieldSharedAccess,
} from 'librechat-data-provider';
import type { TEffectiveAccess } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { readConfigSection } from '~/app/config';
import { findHiggsfieldServer } from './config';

/** Where the admin panel stores the shared Higgsfield account's email (a `__base__` override). */
export const HIGGSFIELD_SHARED_OWNER_FIELD = 'mediaGeneration.higgsfieldSharedOwnerEmail';

const envVarPattern = /^\$\{.+\}$/;

/** A trimmed, lowercased email, or undefined when empty or an unresolved `${ENV}` reference. */
export function normalizeOwnerEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const email = extractEnvVariable(value).trim().toLowerCase();
  return email && !envVarPattern.test(email) ? email : undefined;
}

/** The email the admin panel chose for the shared account, if any. */
export function readAdminOwnerEmail(appConfig: AppConfig | null | undefined): string | undefined {
  return normalizeOwnerEmail(
    readConfigSection(appConfig, 'mediaGeneration')?.higgsfieldSharedOwnerEmail,
  );
}

export interface HiggsfieldSharedOwner {
  email?: string;
  /** `admin`: chosen in the admin panel; `env`: `sharedOAuth.ownerEmail` from the config file */
  source?: 'admin' | 'env';
}

/**
 * The shared Higgsfield account's owner: the admin panel's choice, else the config file's
 * `sharedOAuth.ownerEmail`. Empty when sharing is off (no `sharedOAuth` on the server).
 */
export function resolveHiggsfieldSharedOwner(
  appConfig: AppConfig | null | undefined,
  entry?: { sharedOAuth?: { ownerEmail?: string } | null } | null,
): HiggsfieldSharedOwner {
  if (!entry?.sharedOAuth) {
    return {};
  }
  const admin = readAdminOwnerEmail(appConfig);
  if (admin) {
    return { email: admin, source: 'admin' };
  }
  const env = normalizeOwnerEmail(entry.sharedOAuth.ownerEmail);
  return env ? { email: env, source: 'env' } : {};
}

/** Whether this user may run on the shared Higgsfield account: admins always, others by switch. */
export function resolveUserHiggsfieldAccess(user: {
  role?: string;
  higgsfieldAccess?: boolean | null;
}): TEffectiveAccess {
  return resolveHiggsfieldSharedAccess({
    isAdmin: user.role === SystemRoles.ADMIN,
    override: user.higgsfieldAccess,
  });
}

export interface HiggsfieldStatusDeps {
  findUserIdByEmail: (email: string) => Promise<string | null>;
  hasMcpConnection: (userId: string, serverName: string) => Promise<boolean>;
}

/** What the admin panel shows about Higgsfield. */
export interface HiggsfieldStatus {
  /** Whether the config file has a Higgsfield MCP server (the own and shared ways) */
  mcpServer: string | null;
  /** Whether `mediaGeneration.higgsfield` exists in the config file */
  apiDeclared: boolean;
  /** Whether both API keys resolve from the environment */
  apiKeysSet: boolean;
  /** Whether the Higgsfield MCP server has `sharedOAuth` (sharing is possible) */
  sharingEnabled: boolean;
  owner: {
    email?: string;
    source?: 'admin' | 'env';
    found: boolean;
    connected: boolean;
  };
}

/** Higgsfield's setup as the admin sees it: API keys, MCP server and the shared account. */
export async function getHiggsfieldStatus(
  appConfig: AppConfig | null | undefined,
  deps: HiggsfieldStatusDeps,
): Promise<HiggsfieldStatus> {
  const higgsfield = findHiggsfieldServer(appConfig);
  const media = readConfigSection(appConfig, 'mediaGeneration');
  const apiBlock = media?.higgsfield as { apiKeyId?: string; apiKeySecret?: string } | undefined;
  const resolves = (value?: string) => {
    if (!value) {
      return false;
    }
    const resolved = extractEnvVariable(value);
    return Boolean(resolved) && !envVarPattern.test(resolved);
  };
  const owner = resolveHiggsfieldSharedOwner(appConfig, higgsfield?.[1]);
  let found = false;
  let connected = false;
  if (owner.email && higgsfield) {
    const ownerId = await deps.findUserIdByEmail(owner.email);
    found = ownerId != null;
    connected = ownerId != null && (await deps.hasMcpConnection(ownerId, higgsfield[0]));
  }
  return {
    mcpServer: higgsfield?.[0] ?? null,
    apiDeclared: apiBlock != null,
    apiKeysSet: resolves(apiBlock?.apiKeyId) && resolves(apiBlock?.apiKeySecret),
    sharingEnabled: Boolean(higgsfield?.[1]?.sharedOAuth),
    owner: { ...owner, found, connected },
  };
}
