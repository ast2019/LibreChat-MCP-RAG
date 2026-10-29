import { userModelAccessUpdateSchema } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { TUserModelAccess } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MODEL_ACCESS_KEYS = ['local', 'private'] as const;

export interface AdminModelAccessDeps {
  /** The user's stored override; `null` when no such user exists. */
  findUserModelAccess: (userId: string) => Promise<{ modelAccess?: TUserModelAccess } | null>;
  /**
   * Stores the user's whole override and evicts their cached auth document, so the next request
   * sees it; `null` when the user no longer exists.
   */
  saveUserModelAccess: (
    userId: string,
    modelAccess: TUserModelAccess,
  ) => Promise<{ modelAccess?: TUserModelAccess } | null>;
}

/** Keeps only the boolean keys, so a stored document never leaks other fields to the response. */
function pickModelAccess(value?: TUserModelAccess | null): TUserModelAccess {
  const access: TUserModelAccess = {};
  for (const key of MODEL_ACCESS_KEYS) {
    if (typeof value?.[key] === 'boolean') {
      access[key] = value[key];
    }
  }
  return access;
}

/**
 * `PATCH /api/admin/users/:id/model-access`: grants (`true`), withholds (`false`) or returns to the
 * role (`null`) the local and private model classes for one user. Omitted keys keep their value.
 */
export function createAdminModelAccessHandlers(deps: AdminModelAccessDeps): {
  updateModelAccess: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function updateModelAccess(req: ServerRequest, res: Response): Promise<Response> {
    const { id } = (req.params ?? {}) as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    const parsed = userModelAccessUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid model access' });
    }
    try {
      const user = await deps.findUserModelAccess(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const next = pickModelAccess(user.modelAccess);
      for (const key of MODEL_ACCESS_KEYS) {
        const value = parsed.data[key];
        if (value === null) {
          delete next[key];
        } else if (typeof value === 'boolean') {
          next[key] = value;
        }
      }
      const saved = await deps.saveUserModelAccess(id, next);
      if (!saved) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.status(200).json({ id, modelAccess: pickModelAccess(saved.modelAccess) });
    } catch (error) {
      logger.error('[adminModelAccess] update error:', error);
      return res.status(500).json({ error: 'Failed to update model access' });
    }
  }

  return { updateModelAccess };
}

/** Stores one boolean per-user switch, or clears it with `null`; `null` when the user is gone. */
type SaveUserSwitch<K extends string> = (
  userId: string,
  value: boolean | null,
) => Promise<Partial<Record<K, boolean>> | null>;

/** `PATCH` handler for one per-user boolean switch (`true`, `false`, or `null` to clear). */
function createUserSwitchHandler<K extends string>(
  field: K,
  save: SaveUserSwitch<K>,
  label: string,
): (req: ServerRequest, res: Response) => Promise<Response> {
  return async (req, res) => {
    const { id } = (req.params ?? {}) as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    const value = (req.body as Record<string, unknown> | undefined)?.[field];
    if (value !== null && typeof value !== 'boolean') {
      return res.status(400).json({ error: `Invalid ${label}` });
    }
    try {
      const saved = await save(id, value);
      if (!saved) {
        return res.status(404).json({ error: 'User not found' });
      }
      const stored = saved[field];
      return res.status(200).json({ id, [field]: typeof stored === 'boolean' ? stored : null });
    } catch (error) {
      logger.error(`[admin ${label}] update error:`, error);
      return res.status(500).json({ error: `Failed to update ${label}` });
    }
  };
}

export interface AdminApiAccessDeps {
  /**
   * Sets (`true`/`false`) or clears (`null`) the user's programming API override and evicts their
   * cached auth document; `null` when the user does not exist.
   */
  saveUserApiAccess: SaveUserSwitch<'apiAccess'>;
}

/**
 * `PATCH /api/admin/users/:id/api-access`: lets one user use the programming API (`true`), stops
 * them (`false`) or returns them to their role's permission (`null`).
 */
export function createAdminApiAccessHandlers(deps: AdminApiAccessDeps): {
  updateApiAccess: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  return {
    updateApiAccess: createUserSwitchHandler('apiAccess', deps.saveUserApiAccess, 'API access'),
  };
}

export interface AdminMediaAccessDeps {
  /** Sets or clears the user's media generation override and evicts their cached auth document. */
  saveUserMediaAccess: SaveUserSwitch<'mediaAccess'>;
}

/**
 * `PATCH /api/admin/users/:id/media-access`: lets one user generate images, video and speech
 * (`true`, even without a pack), stops them (`false`) or follows the deployment rule (`null`).
 */
export function createAdminMediaAccessHandlers(deps: AdminMediaAccessDeps): {
  updateMediaAccess: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  return {
    updateMediaAccess: createUserSwitchHandler(
      'mediaAccess',
      deps.saveUserMediaAccess,
      'media access',
    ),
  };
}
