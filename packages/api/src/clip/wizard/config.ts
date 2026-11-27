import type { TClipWizardConfigResponse, TClipToolsConfig } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { CLIP_THEMES, CLIP_THEME_LABELS } from '../themes';
import { CLIP_ASPECT_RATIOS } from '../scene';
import { pexelsKey } from '../images';
import { openWizard } from './access';

export function wizardConfigBody(
  config: TClipToolsConfig,
  env: Record<string, string | undefined>,
): TClipWizardConfigResponse {
  return {
    enabled: true,
    voices: config.voices.map((entry) => ({
      id: entry.id,
      label: entry.label,
      lang: entry.lang,
      provider: entry.provider,
      ...(entry.model ? { model: entry.model } : {}),
      priceHint: entry.provider === 'edge' ? ('free' as const) : ('paid' as const),
      ...(entry.provider === 'openrouter' && entry.estimateUsdPerKChar != null
        ? { estimateUsdPerKChar: entry.estimateUsdPerKChar }
        : {}),
      hasSample: entry.provider === 'openrouter',
    })),
    limits: {
      maxDurationSec: config.maxDurationSec,
      maxScenes: config.maxScenes,
      maxAssetMb: config.maxAssetMb,
    },
    aspectRatios: [...CLIP_ASPECT_RATIOS],
    themes: CLIP_THEMES.map((id) => ({ id, label: CLIP_THEME_LABELS[id] })),
    imageSources: {
      builtin: true,
      stock: pexelsKey(config.stockImages, env) != null,
      ai: config.aiImages,
      higgsfield: false,
    },
  };
}

/** GET config: what the wizard may offer this user, or a stable refusal. */
export async function getWizardConfig(
  req: ServerRequest,
  deps: Pick<ClipWizardDeps, 'findBalanceByUser' | 'env'>,
): Promise<WizardReply<TClipWizardConfigResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  return { status: 200, body: wizardConfigBody(gate.config, deps.env ?? process.env) };
}
