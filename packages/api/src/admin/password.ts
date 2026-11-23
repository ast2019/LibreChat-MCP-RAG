import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { PasswordResetUpdate } from '~/auth/passwordResetUpdate';
import { createPasswordResetUpdate } from '~/auth/passwordResetUpdate';

type AdminRequest = Request & { user?: IUser & { id?: string } };

const MAX_PASSWORD_LENGTH = 128;

export interface AdminSetPasswordDeps {
  findUser: (userId: string) => Promise<Pick<IUser, 'role' | 'email' | 'provider'> | null>;
  hashSecret: (plain: string) => Promise<string>;
  /**
   * Stores the new hash with `credentialsChangedAt` (so access and refresh tokens issued before
   * it stop verifying) and clears any staged 2FA enrollment; `null` when the user no longer exists
   */
  savePassword: (userId: string, update: PasswordResetUpdate) => Promise<unknown | null>;
  /** Ends the user's signed-in sessions, so the old password's sessions stop working */
  endSessions: (userId: string) => Promise<unknown>;
  /** Resolves once no cached auth document from before the change can be served */
  awaitAuthUserDocEviction: (userId: string) => Promise<void>;
  /** Whether the requester may act on admin accounts (role management, not just users) */
  canManageAdmins: (req: AdminRequest) => Promise<boolean>;
  minPasswordLength?: number;
}

/**
 * `PATCH /api/admin/users/:id/password`: an admin sets a new password for one user, for when
 * the user cannot recover it (no email service, password reset off, or a sign-up repeated with
 * another password). Like a password reset, the change retires every token issued before it,
 * ends the user's sessions and evicts the cached user. `sessionsEnded: false` tells the admin
 * that the sessions or the cache could not be cleared (the tokens are still retired by the
 * stamp once the cache expires). Admin accounts need role management, so a user manager cannot
 * take an admin account over.
 */
export function createAdminSetPasswordHandler(
  deps: AdminSetPasswordDeps,
): (req: AdminRequest, res: Response) => Promise<Response> {
  const minLength = deps.minPasswordLength ?? 8;
  return async (req, res) => {
    const { id } = (req.params ?? {}) as { id?: string };
    if (!id || !isValidObjectIdString(id)) {
      return res.status(400).json({ error: { code: 'invalid_user_id' } });
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (
      typeof password !== 'string' ||
      password.length < minLength ||
      password.length > MAX_PASSWORD_LENGTH ||
      password.trim().length === 0
    ) {
      return res.status(400).json({ error: { code: 'invalid_password', minLength } });
    }
    try {
      const user = await deps.findUser(id);
      if (!user) {
        return res.status(404).json({ error: { code: 'user_not_found' } });
      }
      if (user.role === SystemRoles.ADMIN && !(await deps.canManageAdmins(req))) {
        return res.status(403).json({ error: { code: 'admin_target_forbidden' } });
      }
      const saved = await deps.savePassword(
        id,
        createPasswordResetUpdate(await deps.hashSecret(password)),
      );
      if (!saved) {
        return res.status(404).json({ error: { code: 'user_not_found' } });
      }
      let sessionsEnded = true;
      try {
        await deps.endSessions(id);
      } catch (error) {
        sessionsEnded = false;
        logger.error(`[adminSetPassword] Could not end the sessions of user ${id}`, error);
      }
      /** After the session deletion, so nothing can mint a post-stamp token while it waits */
      try {
        await deps.awaitAuthUserDocEviction(id);
      } catch (error) {
        sessionsEnded = false;
        logger.error(`[adminSetPassword] Could not evict the cached user ${id}`, error);
      }
      logger.warn(`[adminSetPassword] Password set for user ${id} by admin ${req.user?.id}`);
      return res.status(200).json({ id, updated: true, sessionsEnded });
    } catch (error) {
      logger.error('[adminSetPassword] update failed', error);
      return res.status(500).json({ error: { code: 'password_update_failed' } });
    }
  };
}
