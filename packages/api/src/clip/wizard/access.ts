import { SystemRoles } from 'librechat-data-provider';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { MediaUser } from '~/media/types';
import type { ServerRequest } from '~/types';
import { getClipConfig, getRemotionServiceTarget } from '../config';
import { checkMediaAccess, getMediaConfig } from '~/media/config';
import { getBalanceConfig } from '~/app/config';
import { fail } from './types';

export type WizardGate =
  | { ok: true; config: TClipToolsConfig }
  | { ok: false; reply: WizardReply<WizardErrorBody> };

/**
 * The wizard's door: signed in, turned on, and allowed. `access: pack` asks the media access
 * rule (`mediaGeneration.paidOnly`, pack `grants.media`, an admin's switch); `everyone` skips it.
 * Paid steps (a billed voice) check media access again where they charge.
 */
export async function openWizard(
  req: ServerRequest,
  deps: Pick<ClipWizardDeps, 'findBalanceByUser'>,
): Promise<WizardGate> {
  const config = getClipConfig(req.config);
  if (!config.clip || !config.wizard.enabled) {
    return { ok: false, reply: fail('wizard_disabled') };
  }
  const user = req.user as unknown as MediaUser | undefined;
  if (!user?.id) {
    return { ok: false, reply: fail('not_allowed') };
  }
  if (config.wizard.access === 'pack') {
    const media = getMediaConfig(req.config);
    if (!media) {
      /** Without media generation there is no pack rule to read; only admins pass. */
      return user.role === SystemRoles.ADMIN
        ? { ok: true, config }
        : { ok: false, reply: fail('not_allowed') };
    }
    const allowed = await checkMediaAccess(
      media,
      user,
      deps.findBalanceByUser,
      getBalanceConfig(req.config)?.packs,
    );
    if (!allowed.ok) {
      return { ok: false, reply: fail('not_allowed') };
    }
  }
  return { ok: true, config };
}

export const renderAvailable = (env: Record<string, string | undefined>): boolean =>
  getRemotionServiceTarget(env) != null;
