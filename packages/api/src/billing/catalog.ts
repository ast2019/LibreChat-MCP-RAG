import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import { balancePackSchema } from 'librechat-data-provider';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { TBalancePack } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import { getBalanceConfig } from '~/app/config';

type PackRequest = Request & { user?: IUser & { id?: string } };

/** Most packs the admin page may define. */
export const MAX_PACKS = 20;
/** Largest pack, in credits ($1,000 of usage). */
export const MAX_PACK_CREDITS = 1_000_000_000;

const packListSchema = z
  .array(balancePackSchema.extend({ credits: z.number().int().positive().max(MAX_PACK_CREDITS) }))
  .max(MAX_PACKS)
  .superRefine((packs, ctx) => {
    const ids = new Set<string>();
    for (const [index, pack] of packs.entries()) {
      if (ids.has(pack.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: 'duplicate' });
      }
      ids.add(pack.id);
    }
  });

/**
 * The pack list an admin sent, validated as a whole: ids unique and well formed, labels and
 * amounts in range. Empty descriptions and empty `grants` are dropped, so a saved pack carries
 * only what was set.
 */
export function parsePackList(
  body: unknown,
): { ok: true; packs: TBalancePack[] } | { ok: false; code: string } {
  const raw = (body as { packs?: unknown } | null)?.packs;
  if (!Array.isArray(raw)) {
    return { ok: false, code: 'packs_required' };
  }
  const cleaned = raw.map((pack) => {
    if (pack == null || typeof pack !== 'object') {
      return pack;
    }
    const { description, grants, ...rest } = pack as Record<string, unknown>;
    const text = typeof description === 'string' ? description.trim() : description;
    const kept =
      grants != null && typeof grants === 'object'
        ? Object.fromEntries(Object.entries(grants).filter(([, value]) => value != null))
        : grants;
    return {
      ...rest,
      ...(text !== '' && text != null && { description: text }),
      ...(kept != null && (typeof kept !== 'object' || Object.keys(kept).length > 0)
        ? { grants: kept }
        : {}),
    };
  });
  const parsed = packListSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[issue.path.length - 1];
    if (issue?.message === 'duplicate') {
      return { ok: false, code: 'duplicate_pack_id' };
    }
    return { ok: false, code: typeof field === 'string' ? `invalid_${field}` : 'invalid_packs' };
  }
  return { ok: true, packs: parsed.data };
}

export interface AdminPackDeps {
  /** The config users resolve under (`__base__` overrides applied) */
  getAppConfig: (req: PackRequest) => Promise<AppConfig>;
  /** Writes dotted fields on the base override document */
  patchBaseFields: (fields: Record<string, unknown>) => Promise<void>;
  /** Drops cached configs so the next request reads the new values */
  invalidate: (tenantId?: string) => Promise<void> | void;
}

/**
 * `PUT /api/admin/balance/packs`: replaces the whole pack list, stored as a deployment-wide
 * override over `balance.packs` in the YAML. Users keep the credit of a removed or changed pack;
 * from the next request a pack's `grants` apply as saved, and a removed pack grants nothing extra.
 * Answers like `GET /packs`.
 */
export function createAdminPackHandlers(deps: AdminPackDeps): {
  updatePacks: (req: PackRequest, res: Response) => Promise<Response>;
} {
  async function updatePacks(req: PackRequest, res: Response): Promise<Response> {
    const parsed = parsePackList(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: { code: parsed.code } });
    }
    try {
      const before = getBalanceConfig(await deps.getAppConfig(req));
      if (before?.enabled !== true) {
        return res.status(409).json({ error: { code: 'balance_disabled' } });
      }
      await deps.patchBaseFields({ 'balance.packs': parsed.packs });
      await deps.invalidate(req.user?.tenantId);
      logger.info(
        `[adminPacks] ${req.user?.id} saved ${parsed.packs.length} packs: ` +
          parsed.packs.map((pack) => pack.id).join(', '),
      );
      const after = getBalanceConfig(await deps.getAppConfig(req));
      const startBalance =
        typeof after?.startBalance === 'number' && after.startBalance > 0 ? after.startBalance : 0;
      return res.status(200).json({
        enabled: after?.enabled === true,
        packs: after?.packs ?? parsed.packs,
        startBalance,
      });
    } catch (error) {
      logger.error('[adminPacks] update failed', error);
      return res.status(500).json({ error: { code: 'packs_update_failed' } });
    }
  }

  return { updatePacks };
}
