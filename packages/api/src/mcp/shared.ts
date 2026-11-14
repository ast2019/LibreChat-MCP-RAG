import { logger } from '@librechat/data-schemas';
import {
  SystemRoles,
  extractEnvVariable,
  resolveHiggsfieldSharedAccess,
} from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { ParsedServerConfig } from './types';

/** `sharedOAuth` on an MCP server: one account's OAuth connection used by the users it allows. */
export interface SharedOAuthConfig {
  /** Fallback owner email from the config file; `${ENV}` references are resolved. The admin
   *  panel's choice (`getOwnerEmail`) wins. */
  ownerEmail?: string;
}

export interface SharedMCPPrincipalDeps {
  findUserByEmail: (email: string) => Promise<IUser | null>;
  /**
   * The user's stored «shared Higgsfield account» switch (`higgsfieldAccess`). Request users are
   * often stripped to identity fields, so the switch is read here; without this dep the value on
   * the user object is used.
   */
  findSharedAccess?: (userId: string) => Promise<boolean | null | undefined>;
  /** The owner email chosen in the admin panel, if any; it wins over `sharedOAuth.ownerEmail`. */
  getOwnerEmail?: () => Promise<string | null | undefined>;
  /**
   * Whether this user holds stored OAuth tokens for the server. When given, a user's own
   * connection wins over the shared one, and the shared one is used only once the owner has
   * connected; otherwise the user keeps their own connection and can authorize it.
   */
  hasOAuthTokens?: (userId: string, serverName: string) => Promise<boolean>;
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
  const shared = (config as { sharedOAuth?: SharedOAuthConfig | null } | undefined)?.sharedOAuth;
  return shared ?? undefined;
}

/** A trimmed, lowercased email, or empty when unset or an unresolved `${ENV}` reference. */
function normalizeEmail(value: string | null | undefined): string {
  const email = value ? extractEnvVariable(value).trim().toLowerCase() : '';
  return /^\$\{.+\}$/.test(email) ? '' : email;
}

/**
 * Resolves who an MCP request runs as. On a server with `sharedOAuth`, an admin, or a user the
 * admin granted the shared account (`higgsfieldAccess`), uses the owner's connection and
 * tokens, unless the user has connected their own account or the owner has not connected yet.
 * Anyone else, and the owner, keeps their own connection as before.
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

  async function isAllowed(user: IUser): Promise<boolean> {
    const isAdmin = user.role === SystemRoles.ADMIN;
    if (isAdmin) {
      return true;
    }
    const override = deps.findSharedAccess
      ? await deps.findSharedAccess(user.id)
      : (user as IUser & { higgsfieldAccess?: boolean | null }).higgsfieldAccess;
    return resolveHiggsfieldSharedAccess({ isAdmin, override }).allowed;
  }

  return async ({ serverName, config, user }) => {
    const shared = sharedConfigOf(config);
    if (!shared || !user?.id) {
      return { user, shared: false };
    }
    if (!(await isAllowed(user))) {
      return { user, shared: false };
    }
    const email = normalizeEmail(await deps.getOwnerEmail?.()) || normalizeEmail(shared.ownerEmail);
    if (!email) {
      return { user, shared: false };
    }
    const owner = await findOwner(email);
    if (!owner?.id) {
      logger.warn(`[MCP][${serverName}] The shared connection owner was not found`);
      return { user, shared: false };
    }
    if (owner.id === user.id) {
      return { user, shared: false };
    }
    if (deps.hasOAuthTokens) {
      if (await deps.hasOAuthTokens(user.id, serverName)) {
        return { user, shared: false };
      }
      if (!(await deps.hasOAuthTokens(owner.id, serverName))) {
        logger.debug(
          `[MCP][${serverName}] Shared owner is not connected; user ${user.id} uses their own`,
        );
        return { user, shared: false };
      }
    }
    logger.debug(`[MCP][${serverName}] User ${user.id} uses the shared connection of ${owner.id}`);
    return { user: owner, shared: true };
  };
}
