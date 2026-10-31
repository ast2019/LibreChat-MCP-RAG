import { SystemRoles, findPackGrants } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { MediaUser } from './types';
import { getMediaConfig, resolveMediaEndpoint, resolveUserMediaAccess } from './config';
import { getBalanceConfig } from '~/app/config';

/** Why a way to generate is or is not usable for this user right now. */
export type MediaWayState =
  | 'active'
  | 'needs_pack'
  | 'disabled_by_admin'
  | 'not_configured'
  | 'needs_connection'
  | 'owner_not_connected'
  | 'not_allowed';

export interface MediaWay {
  id: 'image' | 'video' | 'speech' | 'higgsfield_api' | 'higgsfield_shared' | 'higgsfield_own';
  state: MediaWayState;
  /** Model names the way uses, for the user to recognise */
  models?: string[];
}

export interface MediaAvailability {
  paidOnly: boolean;
  hasPack: boolean;
  /** The admin's per-user switch, when set */
  userSwitch: boolean | null;
  ways: MediaWay[];
  /** The MCP server name to pick in the composer for Higgsfield, when configured */
  higgsfieldServer?: string;
}

export interface MediaAvailabilityDeps {
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  /** Whether this user has stored OAuth tokens for the MCP server */
  hasMcpConnection: (userId: string, serverName: string) => Promise<boolean>;
  findUserIdByEmail: (email: string) => Promise<string | null>;
}

type McpEntry = { url?: string; sharedOAuth?: { ownerEmail?: string; allow?: string } };

function findHiggsfieldServer(appConfig: AppConfig | null | undefined): [string, McpEntry] | null {
  const servers = (appConfig as { mcpConfig?: Record<string, McpEntry> } | undefined)?.mcpConfig;
  for (const [name, entry] of Object.entries(servers ?? {})) {
    try {
      if (entry?.url && new URL(entry.url).hostname.endsWith('higgsfield.ai')) {
        return [name, entry];
      }
    } catch {
      continue;
    }
  }
  return null;
}

function deniedState(userSwitch: boolean | null, allow: string): MediaWayState {
  if (userSwitch === false) {
    return 'disabled_by_admin';
  }
  return allow === 'paid' ? 'needs_pack' : 'not_allowed';
}

/**
 * Every way this user can make images and videos, and what each needs: one answer for the
 * «ساخت تصویر و ویدیو» panel, so the three Higgsfield routes are never a guess.
 */
export async function getMediaAvailability(
  appConfig: AppConfig | null | undefined,
  user: MediaUser & { mediaAccess?: boolean | null },
  deps: MediaAvailabilityDeps,
): Promise<MediaAvailability> {
  const config = getMediaConfig(appConfig);
  const isAdmin = user.role === SystemRoles.ADMIN;
  const userSwitch = typeof user.mediaAccess === 'boolean' ? user.mediaAccess : null;
  const higgsfield = findHiggsfieldServer(appConfig);
  const balance = await deps.findBalanceByUser(user.id);
  const hasPack = Boolean(balance?.packId);
  const paidOnly = config?.paidOnly !== false;
  const packs = getBalanceConfig(appConfig ?? undefined)?.packs;
  /** Whether the current pack includes media; `undefined` when the pack does not say */
  const packGrant = findPackGrants(packs, balance?.packId)?.media;
  const generatorAllowed = resolveUserMediaAccess(config, user, balance?.packId, packs).allowed;

  /** The same rule the tools apply when they run. */
  const generatorState = (configured: boolean): MediaWayState => {
    if (!configured) {
      return 'not_configured';
    }
    if (userSwitch === false) {
      return 'disabled_by_admin';
    }
    return generatorAllowed ? 'active' : 'needs_pack';
  };

  const endpointReady = config != null && resolveMediaEndpoint(appConfig, config) != null;
  const ways: MediaWay[] = [
    {
      id: 'image',
      state: generatorState(endpointReady && config?.image != null),
      ...(config?.image ? { models: [config.image.model] } : {}),
    },
    {
      id: 'video',
      state: generatorState(endpointReady && config?.video != null),
      ...(config?.video ? { models: [config.video.model] } : {}),
    },
    {
      id: 'speech',
      state: generatorState(endpointReady && config?.speech != null),
      ...(config?.speech ? { models: [config.speech.model] } : {}),
    },
    {
      id: 'higgsfield_api',
      state: generatorState(config?.higgsfield != null),
      ...(config?.higgsfield ? { models: config.higgsfield.models.map((m) => m.label) } : {}),
    },
  ];

  if (higgsfield) {
    const [serverName, entry] = higgsfield;
    const ownConnected = await deps.hasMcpConnection(user.id, serverName);
    const ownerEmail = entry.sharedOAuth?.ownerEmail?.trim().toLowerCase();
    let shared: MediaWayState = 'not_configured';
    if (ownerEmail && !/^\$\{.+\}$/.test(ownerEmail)) {
      const ownerId = await deps.findUserIdByEmail(ownerEmail);
      const allow = entry.sharedOAuth?.allow ?? 'paid';
      const allowed =
        userSwitch ?? (isAdmin || allow === 'all' || (allow === 'paid' && (packGrant ?? hasPack)));
      if (!ownerId) {
        shared = 'owner_not_connected';
      } else if (ownerId === user.id) {
        shared = ownConnected ? 'active' : 'needs_connection';
      } else if (!allowed) {
        shared = deniedState(userSwitch, allow);
      } else {
        shared = (await deps.hasMcpConnection(ownerId, serverName))
          ? 'active'
          : 'owner_not_connected';
      }
    }
    ways.push({ id: 'higgsfield_shared', state: shared });
    ways.push({ id: 'higgsfield_own', state: ownConnected ? 'active' : 'needs_connection' });
  }

  return {
    paidOnly,
    hasPack,
    userSwitch,
    ways,
    ...(higgsfield ? { higgsfieldServer: higgsfield[0] } : {}),
  };
}
