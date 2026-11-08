import { logger } from '@librechat/data-schemas';
import {
  STATEFUL_CODE_ENVIRONMENTS,
  resolveAllowedStatefulCodeEnvironments,
} from 'librechat-data-provider';
import type {
  StatefulCodeEnvironment,
  TUpdateUserPreferencesRequest,
} from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ImageCatalogueModel } from '~/media/catalogue';
import type { ServerRequest } from '~/types';
import { getSharedImageModelCatalogue } from '~/media/catalogue';
import { listImageModels } from '~/media/models';
import { getMediaConfig } from '~/media/config';

interface UserPreferencesBody {
  statefulCodeEnvironment?: string;
  imageModel?: string;
}

function isStatefulCodeEnvironment(value: string): value is StatefulCodeEnvironment {
  return STATEFUL_CODE_ENVIRONMENTS.some((environment) => environment === value);
}

type UserPreferencesRequest = Omit<ServerRequest, 'body' | 'user'> & {
  body: UserPreferencesBody;
  user?: IUser;
};

export interface UserPreferencesHandlerDeps {
  updateStatefulCodeEnvironment: (
    userId: string,
    environment: StatefulCodeEnvironment,
  ) => Promise<IUser | null>;
  updateImageModel?: (userId: string, imageModel: string) => Promise<IUser | null>;
  /** The endpoint's image models; defaults to the process-wide catalogue */
  imageCatalogue?: () => readonly ImageCatalogueModel[] | undefined;
}

type Checked<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

function checkEnvironment(
  req: UserPreferencesRequest,
  value: unknown,
): Checked<StatefulCodeEnvironment> {
  if (typeof value !== 'string' || !isStatefulCodeEnvironment(value)) {
    return {
      ok: false,
      status: 400,
      message: `statefulCodeEnvironment must be one of: ${STATEFUL_CODE_ENVIRONMENTS.join(', ')}`,
    };
  }
  const allowed = resolveAllowedStatefulCodeEnvironments(
    req.config?.endpoints?.agents?.statefulCodeSessions?.allowedEnvironments,
  );
  if (!allowed.includes(value)) {
    return {
      ok: false,
      status: 403,
      message: `statefulCodeEnvironment is not allowed by this deployment: ${value}`,
    };
  }
  return { ok: true, value };
}

function checkImageModel(
  req: UserPreferencesRequest,
  value: unknown,
  readCatalogue: () => readonly ImageCatalogueModel[] | undefined,
): Checked<string> {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    return { ok: false, status: 400, message: 'imageModel must be a model id' };
  }
  const image = getMediaConfig(req.config)?.image;
  const offered = image
    ? listImageModels(image, image.catalogue ? readCatalogue() : undefined)
    : [];
  if (!offered.some((model) => model.id === value)) {
    return { ok: false, status: 403, message: 'imageModel is not offered by this deployment' };
  }
  return { ok: true, value };
}

/** `PATCH /api/user/preferences`: one or both of the code workspace default and the image model. */
export function createUserPreferencesHandler(
  deps: UserPreferencesHandlerDeps,
): (req: UserPreferencesRequest, res: Response) => Promise<Response> {
  const readCatalogue = deps.imageCatalogue ?? (() => getSharedImageModelCatalogue().getModels());
  return async (req: UserPreferencesRequest, res: Response): Promise<Response> => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const body = req.body ?? {};
    const wantsEnvironment = body.statefulCodeEnvironment !== undefined;
    const wantsImageModel = body.imageModel !== undefined && deps.updateImageModel != null;
    if (!wantsEnvironment && !wantsImageModel) {
      return res.status(400).json({
        message: `statefulCodeEnvironment must be one of: ${STATEFUL_CODE_ENVIRONMENTS.join(', ')}`,
      });
    }

    const environment = wantsEnvironment
      ? checkEnvironment(req, body.statefulCodeEnvironment)
      : undefined;
    if (environment && !environment.ok) {
      return res.status(environment.status).json({ message: environment.message });
    }
    const imageModel = wantsImageModel
      ? checkImageModel(req, body.imageModel, readCatalogue)
      : undefined;
    if (imageModel && !imageModel.ok) {
      return res.status(imageModel.status).json({ message: imageModel.message });
    }

    try {
      let updatedUser: IUser | null = null;
      const preferences: TUpdateUserPreferencesRequest = {};
      if (environment?.ok) {
        updatedUser = await deps.updateStatefulCodeEnvironment(userId, environment.value);
        if (!updatedUser) {
          return res.status(404).json({ message: 'User not found' });
        }
        preferences.statefulCodeEnvironment =
          updatedUser.personalization?.statefulCodeEnvironment ?? environment.value;
      }
      if (imageModel?.ok && deps.updateImageModel) {
        updatedUser = await deps.updateImageModel(userId, imageModel.value);
        if (!updatedUser) {
          return res.status(404).json({ message: 'User not found' });
        }
        preferences.imageModel = updatedUser.personalization?.imageModel ?? imageModel.value;
      }
      return res.status(200).json({ updated: true, preferences });
    } catch (error) {
      logger.error('[UserPreferences] Error updating preferences:', error);
      return res.status(500).json({ message: 'Failed to update user preferences' });
    }
  };
}
