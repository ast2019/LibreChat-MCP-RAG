import { logger } from '@librechat/data-schemas';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { HiggsfieldStatus, HiggsfieldStatusDeps } from '~/media/higgsfieldShared';
import { getHiggsfieldStatus, HIGGSFIELD_SHARED_OWNER_FIELD } from '~/media/higgsfieldShared';

type AdminRequest = Request & { user?: IUser & { id?: string } };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export interface AdminHiggsfieldDeps extends HiggsfieldStatusDeps {
  /** The deployment config with `__base__` overrides applied */
  getAppConfig: (req: AdminRequest) => Promise<AppConfig>;
  /** Writes dotted fields on the base override document */
  patchBaseFields: (fields: Record<string, unknown>) => Promise<void>;
  /** Removes dotted fields from the base override document */
  unsetBaseFields: (paths: string[]) => Promise<void>;
  /** Drops cached configs so the next request reads the new values */
  invalidate: (tenantId?: string) => Promise<void> | void;
}

/**
 * `GET|PUT /api/admin/higgsfield`: Higgsfield's setup (API keys, MCP server, shared account) and
 * the shared account's owner. PUT `{ ownerEmail }` picks an existing user; `null` clears the
 * choice, so the config file's `sharedOAuth.ownerEmail` (if any) applies again.
 */
export function createAdminHiggsfieldHandlers(deps: AdminHiggsfieldDeps): {
  getHiggsfield: (req: AdminRequest, res: Response) => Promise<Response>;
  updateHiggsfield: (req: AdminRequest, res: Response) => Promise<Response>;
} {
  const current = async (req: AdminRequest): Promise<HiggsfieldStatus> =>
    getHiggsfieldStatus(await deps.getAppConfig(req), deps);

  async function getHiggsfield(req: AdminRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await current(req));
    } catch (error) {
      logger.error('[adminHiggsfield] read failed', error);
      return res.status(500).json({ error: { code: 'higgsfield_read_failed' } });
    }
  }

  async function updateHiggsfield(req: AdminRequest, res: Response): Promise<Response> {
    const raw = (req.body as { ownerEmail?: unknown } | undefined)?.ownerEmail;
    if (raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ error: { code: 'invalid_owner_email' } });
    }
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) {
      return res.status(400).json({ error: { code: 'invalid_owner_email' } });
    }
    try {
      if (email) {
        if (!(await deps.findUserIdByEmail(email))) {
          return res.status(400).json({ error: { code: 'owner_not_found' } });
        }
        await deps.patchBaseFields({ [HIGGSFIELD_SHARED_OWNER_FIELD]: email });
      } else {
        await deps.unsetBaseFields([HIGGSFIELD_SHARED_OWNER_FIELD]);
      }
      await deps.invalidate(req.user?.tenantId);
      logger.info(
        `[adminHiggsfield] ${req.user?.id} ${email ? 'set' : 'cleared'} the shared account owner`,
      );
      return res.status(200).json(await current(req));
    } catch (error) {
      logger.error('[adminHiggsfield] update failed', error);
      return res.status(500).json({ error: { code: 'higgsfield_update_failed' } });
    }
  }

  return { getHiggsfield, updateHiggsfield };
}
