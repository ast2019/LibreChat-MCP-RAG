import type {
  TClipToolsConfig,
  TClipWizardModel,
  TClipWizardImageModel,
  TClipWizardConfigResponse,
} from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { CLIP_THEMES, CLIP_THEME_LABELS } from '../themes';
import { listWizardModels, publicModels } from './models';
import { CLIP_ASPECT_RATIOS } from '../scene';
import { wizardImagesOn } from './effect';
import { getMediaConfig } from '~/media/config';
import { pexelsKey } from '../images';
import { openWizard } from './access';

/** What the deployment can make, beyond the clip settings: models, image models, paid speech. */
export interface WizardCapabilities {
  models: TClipWizardModel[];
  imageModels: TClipWizardImageModel[];
  /** `media.speech` is configured, so paid voices can speak */
  speech: boolean;
  /** The Higgsfield keys resolve on the server */
  higgsfield: boolean;
}

const NONE: WizardCapabilities = { models: [], imageModels: [], speech: true, higgsfield: false };

export function wizardConfigBody(
  config: TClipToolsConfig,
  env: Record<string, string | undefined>,
  capabilities: WizardCapabilities = NONE,
): TClipWizardConfigResponse {
  const imagesOn = wizardImagesOn(config);
  const imageModels = imagesOn
    ? capabilities.imageModels.filter((model) => model.source !== 'higgsfield' || capabilities.higgsfield)
    : [];
  return {
    enabled: true,
    voices: config.voices
      .filter((entry) => entry.provider !== 'openrouter' || capabilities.speech)
      .map((entry) => ({
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
    models: capabilities.models,
    defaultModelId: capabilities.models[0]?.id ?? null,
    imageModels,
    imageCapCredits: config.wizard.images.maxCreditsPerClip,
    limits: {
      maxDurationSec: config.maxDurationSec,
      maxScenes: config.maxScenes,
      maxAssetMb: config.maxAssetMb,
      maxAiImages: config.maxAiImages,
      maxChatChars: config.wizard.llm.maxChatChars,
    },
    aspectRatios: [...CLIP_ASPECT_RATIOS],
    themes: CLIP_THEMES.map((id) => ({ id, label: CLIP_THEME_LABELS[id] })),
    imageSources: {
      builtin: true,
      stock: pexelsKey(config.stockImages, env) != null,
      ai: imageModels.some((model) => model.source === 'openrouter'),
      higgsfield: imageModels.some((model) => model.source === 'higgsfield'),
    },
  };
}

/** GET config: what the wizard may offer this user, or a stable refusal. */
export async function getWizardConfig(
  req: ServerRequest,
  deps: Pick<ClipWizardDeps, 'findBalanceByUser' | 'env' | 'images' | 'llm'>,
): Promise<WizardReply<TClipWizardConfigResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const media = getMediaConfig(req.config);
  const capabilities: WizardCapabilities = {
    models: deps.llm ? publicModels(listWizardModels(req, gate.config)) : [],
    imageModels: deps.images?.models?.(req) ?? [],
    speech: media?.speech != null,
    higgsfield: media?.higgsfield != null,
  };
  return { status: 200, body: wizardConfigBody(gate.config, deps.env ?? process.env, capabilities) };
}
