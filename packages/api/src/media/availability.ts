import type { TMediaImageModel } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ImageCatalogueModel } from './catalogue';
import type { MediaUser } from './types';
import {
  getMediaConfig,
  findHiggsfieldServer,
  resolveMediaEndpoint,
  resolveUserMediaAccess,
} from './config';
import { getSharedImageModelCatalogue } from './catalogue';
import { getBalanceConfig } from '~/app/config';
import { listImageModels } from './models';
import { resolveHiggsfieldSharedOwner, resolveUserHiggsfieldAccess } from './higgsfieldShared';

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
  /** Every image model the user may pick, the default first */
  imageModels?: TMediaImageModel[];
}

export interface MediaAvailabilityDeps {
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  /** Whether this user has stored OAuth tokens for the MCP server */
  hasMcpConnection: (userId: string, serverName: string) => Promise<boolean>;
  findUserIdByEmail: (email: string) => Promise<string | null>;
  /** The endpoint's image models; defaults to the process-wide catalogue */
  imageCatalogue?: () => readonly ImageCatalogueModel[] | undefined;
}

const readSharedCatalogue = () => getSharedImageModelCatalogue().getModels();

/**
 * Every way this user can make images and videos, and what each needs: one answer for the
 * «ساخت تصویر و ویدیو» panel, so the three Higgsfield routes are never a guess.
 */
export async function getMediaAvailability(
  appConfig: AppConfig | null | undefined,
  user: MediaUser & { mediaAccess?: boolean | null; higgsfieldAccess?: boolean | null },
  deps: MediaAvailabilityDeps,
): Promise<MediaAvailability> {
  const config = getMediaConfig(appConfig);
  const userSwitch = typeof user.mediaAccess === 'boolean' ? user.mediaAccess : null;
  const higgsfield = findHiggsfieldServer(appConfig);
  const balance = await deps.findBalanceByUser(user.id);
  const hasPack = Boolean(balance?.packId);
  const paidOnly = config?.paidOnly !== false;
  const packs = getBalanceConfig(appConfig ?? undefined)?.packs;
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
    const owner = resolveHiggsfieldSharedOwner(appConfig, entry);
    let shared: MediaWayState = 'not_configured';
    if (owner.email) {
      const ownerId = await deps.findUserIdByEmail(owner.email);
      if (ownerId === user.id) {
        shared = ownConnected ? 'active' : 'needs_connection';
      } else if (!resolveUserHiggsfieldAccess(user).allowed) {
        shared = 'not_allowed';
      } else if (!ownerId) {
        shared = 'owner_not_connected';
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
    ...(config?.image
      ? {
          /** Priced as the user pays: the hold estimate with the endpoint's markup */
          imageModels: listImageModels(
            config.image,
            config.image.catalogue ? (deps.imageCatalogue ?? readSharedCatalogue)() : undefined,
          ).map((model) => ({
            ...model,
            estimateUsd:
              model.estimateUsd * (resolveMediaEndpoint(appConfig, config)?.priceMultiplier ?? 1),
          })),
        }
      : {}),
  };
}
