import type { TClipToolsConfig, TClipWizardImages, TClipWizardErrorCode } from 'librechat-data-provider';
import type { ClipImagePick, ClipImageRefusal } from '../images';
import type { ClipWizardDeps, WizardErrorBody, WizardReply } from './types';
import type { ServerRequest } from '~/types';
import { fail } from './types';

/** Whether the deployment lets the wizard render AI images at all. */
export const wizardImagesOn = (config: TClipToolsConfig): boolean =>
  config.aiImages || config.wizard.images.enabled;

/** The wizard's refusal code for an image service refusal. */
export function imageRefusalCode(refusal: ClipImageRefusal | undefined): TClipWizardErrorCode {
  switch (refusal) {
    case 'insufficient_credit':
      return 'insufficient_credit';
    case 'cap_exceeded':
      return 'cap_exceeded';
    case 'unknown_model':
      return 'model_unavailable';
    case 'not_allowed':
      return 'not_allowed';
    default:
      return 'unavailable';
  }
}

export interface ResolvedImages {
  /** The config storyboards are validated and rendered with: `aiImages` follows the user's pick */
  config: TClipToolsConfig;
  pick?: ClipImagePick;
  /** The cap that applies, in credits (the stricter of the user's and the deployment's) */
  capCredits?: number;
  /** Estimated credits per AI image of the pick; 0 without AI images */
  perImage: number;
  /** AI images the cap and the deployment allow in one clip */
  allowed: number;
}

/**
 * The effective settings for one request. `builtin` turns AI images off; another source needs
 * the deployment's lever (`aiImages` or `wizard.images.enabled`) and a model this deployment
 * offers (Higgsfield only while its keys resolve). No pick keeps the deployment's own rule.
 */
export function resolveImages(
  req: ServerRequest,
  config: TClipToolsConfig,
  deps: Pick<ClipWizardDeps, 'images'>,
  images: TClipWizardImages | undefined,
): { ok: true; value: ResolvedImages } | { ok: false; reply: WizardReply<WizardErrorBody> } {
  const stricter = (a: number, b: number): number | undefined => {
    const caps = [a, b].filter((cap) => cap > 0);
    return caps.length ? Math.min(...caps) : undefined;
  };
  const capCredits = stricter(images?.maxCredits ?? 0, config.wizard.images.maxCreditsPerClip);
  if (!images) {
    return { ok: true, value: { config, capCredits, perImage: 0, allowed: config.aiImages ? config.maxAiImages : 0 } };
  }
  if (images.source === 'builtin') {
    return { ok: true, value: { config: { ...config, aiImages: false }, capCredits, perImage: 0, allowed: 0 } };
  }
  if (!wizardImagesOn(config) || !deps.images) {
    return { ok: false, reply: fail('unavailable') };
  }
  const pick: ClipImagePick = { source: images.source, ...(images.modelId ? { modelId: images.modelId } : {}) };
  const estimate = deps.images.estimate?.(req, 1, pick);
  if (!estimate?.ok) {
    return { ok: false, reply: fail(imageRefusalCode(estimate?.code)) };
  }
  const byCap = capCredits && estimate.perImage > 0 ? Math.floor(capCredits / estimate.perImage) : Infinity;
  return {
    ok: true,
    value: {
      config: { ...config, aiImages: true },
      pick,
      capCredits,
      perImage: estimate.perImage,
      allowed: Math.max(0, Math.min(config.maxAiImages, byCap)),
    },
  };
}
