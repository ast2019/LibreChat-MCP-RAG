import { logger } from '@librechat/data-schemas';
import { SystemRoles, findPackGrants, extractEnvVariable } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { TPackGrants } from 'librechat-data-provider';
import type { ParsedServerConfig } from './types';

/** `sharedOAuth` on an MCP server: one account's OAuth connection used by the users it allows. */
export interface SharedOAuthConfig {
  /** Email of the account whose connection is shared; `${ENV}` references are resolved */
  ownerEmail: string;
  /** Who may use it besides admins: everyone, users with a pack, or admins only */
  allow?: 'all' | 'paid' | 'admins';
}

export interface SharedMCPPrincipalDeps {
  findUserByEmail: (email: string) => Promise<IUser | null>;
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  /** The configured balance packs, whose `grants.media` decides the `paid` rule per pack. */
  getPacks?: () => ReadonlyArray<{ id?: string; grants?: TPackGrants }> | null | undefined;
  now?: () => number;
}

export interface SharedMCPPrincipal {
  /** The user the connection, its tokens and its flows are keyed by */
  user: IUser;
  /** True when this is the owner standing in for the requester */
  shared: boolean;
}

export type SharedMCPPrincipalResolver = (args: {
  serverName: string;
  config: ParsedServerConfig | undefined;
  user: IUser;
}) => Promise<SharedMCPPrincipal>;

const OWNER_CACHE_MS = 60_000;

function sharedConfigOf(config: ParsedServerConfig | undefined): SharedOAuthConfig | undefined {
  const shared = (config as { sharedOAuth?: SharedOAuthConfig } | undefined)?.sharedOAuth;
  return shared?.ownerEmail ? shared : undefined;
}

/**
 * Resolves who an MCP request runs as. On a server with `sharedOAuth`, a user the rule allows
 * (an admin's per-user media switch wins; admins always may) uses the owner's connection and
 * tokens; anyone else, and the owner, keeps their own connection as before.
 */
export function createSharedMCPPrincipalResolver(
  deps: SharedMCPPrincipalDeps,
): SharedMCPPrincipalResolver {
  const now = deps.now ?? Date.now;
  const owners = new Map<string, { user: IUser | null; at: number }>();

  async function findOwner(email: string): Promise<IUser | null> {
    const cached = owners.get(email);
    if (cached && now() - cached.at < OWNER_CACHE_MS) {
      return cached.user;
    }
    const user = await deps.findUserByEmail(email);
    if (user && user.id == null && user._id != null) {
      user.id = String(user._id);
    }
    owners.set(email, { user, at: now() });
    return user;
  }

  async function isAllowed(user: IUser, shared: SharedOAuthConfig): Promise<boolean> {
    const override = (user as IUser & { mediaAccess?: boolean | null }).mediaAccess;
    if (override === true || override === false) {
      return override;
    }
    if (user.role === SystemRoles.ADMIN) {
      return true;
    }
    const allow = shared.allow ?? 'paid';
    if (allow === 'all') {
      return true;
    }
    if (allow === 'admins') {
      return false;
    }
    const balance = await deps.findBalanceByUser(user.id);
    /** A pack that says whether it includes media decides; any other pack counts as paid */
    return findPackGrants(deps.getPacks?.(), balance?.packId)?.media ?? Boolean(balance?.packId);
  }

  return async ({ serverName, config, user }) => {
    const shared = sharedConfigOf(config);
    if (!shared || !user?.id) {
      return { user, shared: false };
    }
    const email = extractEnvVariable(shared.ownerEmail).trim().toLowerCase();
    if (!email || /^\$\{.+\}$/.test(email)) {
      return { user, shared: false };
    }
    const owner = await findOwner(email);
    if (!owner?.id) {
      logger.warn(`[MCP][${serverName}] The shared connection owner was not found`);
      return { user, shared: false };
    }
    if (owner.id === user.id || !(await isAllowed(user, shared))) {
      return { user, shared: false };
    }
    logger.debug(`[MCP][${serverName}] User ${user.id} uses the shared connection of ${owner.id}`);
    return { user: owner, shared: true };
  };
}
