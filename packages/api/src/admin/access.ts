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

export interface AdminApiAccessDeps {
  /**
   * Sets (`true`/`false`) or clears (`null`) the user's programming API override and evicts their
   * cached auth document; `null` when the user does not exist.
   */
  saveUserApiAccess: (
    userId: string,
    apiAccess: boolean | null,
  ) => Promise<{ apiAccess?: boolean } | null>;
}

/**
 * `PATCH /api/admin/users/:id/api-access`: lets one user use the programming API (`true`), stops
 * them (`false`) or returns them to their role's permission (`null`).
 */
export function createAdminApiAccessHandlers(deps: AdminApiAccessDeps): {
  updateApiAccess: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function updateApiAccess(req: ServerRequest, res: Response): Promise<Response> {
    const { id } = (req.params ?? {}) as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    const value = (req.body as { apiAccess?: unknown } | undefined)?.apiAccess;
    if (value !== null && typeof value !== 'boolean') {
      return res.status(400).json({ error: 'Invalid API access' });
    }
    try {
      const saved = await deps.saveUserApiAccess(id, value);
      if (!saved) {
        return res.status(404).json({ error: 'User not found' });
      }
      const apiAccess = typeof saved.apiAccess === 'boolean' ? saved.apiAccess : null;
      return res.status(200).json({ id, apiAccess });
    } catch (error) {
      logger.error('[adminApiAccess] update error:', error);
      return res.status(500).json({ error: 'Failed to update API access' });
    }
  }

  return { updateApiAccess };
}
