import { randomUUID } from 'crypto';
import { MEDIA_TRANSACTION_CONTEXTS } from 'librechat-data-provider';
import type { TMediaGenerationConfig, TClipWizardImageModel } from 'librechat-data-provider';
import type { BalanceReservation } from '~/middleware/checkBalance';
import type { MediaBilling, MediaCharge } from '~/media/billing';
import type { MediaFetch, MediaUser } from '~/media/types';
import type { MediaAccessResult } from '~/media/config';
import type { ImageCatalogueModel } from '~/media/catalogue';
import type { ClipAspectRatio } from './scene';
import type { ServerRequest } from '~/types';
import { checkMediaAccess, getMediaConfig, resolveMediaEndpoint } from '~/media/config';
import { generateOpenRouterImage, generateHiggsfield } from '~/media/providers';
import { getSharedImageModelCatalogue } from '~/media/catalogue';
import { listImageModels } from '~/media/models';
import { getBalanceConfig } from '~/app/config';
import { mediaCredits } from '~/media/billing';

/** Why an AI image was not generated (the job fails with a matching code). */
export type ClipImageRefusal =
  | 'unconfigured'
  | 'not_allowed'
  | 'insufficient_credit'
  | 'unknown_model'
  | 'cap_exceeded';

/** Where a clip's AI images come from; absent means the OpenRouter default model. */
export interface ClipImagePick {
  source: 'openrouter' | 'higgsfield';
  /** An id from {@link ClipImageService.models}; unknown ids are refused, never defaulted */
  modelId?: string;
}

/** Hooks that keep a retried job from charging one image or line twice. */
export interface ClipChargeHooks {
  /** Awaited after the provider answered and before the ledger write, with the credits about to be charged */
  beforeRecord?: (credits: number) => Promise<void>;
  /** A previous attempt may already have recorded this charge: record nothing, return these credits */
  alreadyCharged?: number;
}

export type ClipImageResult =
  | { ok: true; buffer: Buffer; type: string; credits: number }
  | { ok: false; code: ClipImageRefusal };

/** The credit held at tool time for a clip's AI images, one reservation per image. */
export interface ClipImageHold {
  /**
   * Keeps the hold for the job until its images are generated or {@link ClipImageService.release}
   * runs; it is dropped by itself after `untilMs` (the job deadline) in any case.
   */
  keep: (jobId: string, untilMs: number) => void;
  /** Releases every reservation (the job was not recorded). */
  release: () => Promise<void>;
}

/** AI images for a clip go through the image tool's path: same access rule, model and ledger. */
export interface ClipImageService {
  /**
   * Checks media access and holds the estimate for `count` images, so a user cannot start a
   * clip they cannot pay for. The tool keeps the hold on the recorded job; each `generate`
   * swaps one image's share for its own hold while the image is made.
   */
  reserve(
    req: ServerRequest,
    count: number,
    conversationId?: string,
    options?: { pick?: ClipImagePick; capCredits?: number },
  ): Promise<{ ok: true; hold: ClipImageHold } | { ok: false; message: string; code: ClipImageRefusal }>;
  /**
   * Generates one image and records its charge (provider cost, else the estimate). Access and
   * balance are checked again first: the user may have spent the credit or changed pack since
   * the tool call, and a refusal charges nothing. Throws when the provider fails.
   */
  generate(
    req: ServerRequest,
    prompt: string,
    aspectRatio: ClipAspectRatio,
    options?: { conversationId?: string; jobId?: string; pick?: ClipImagePick } & ClipChargeHooks,
  ): Promise<ClipImageResult>;
  /** The image models this deployment offers (Higgsfield ones only while its keys resolve). */
  models?(req: ServerRequest): TClipWizardImageModel[];
  /** What `count` images of the pick are estimated at, without holding anything. */
  estimate?(
    req: ServerRequest,
    count: number,
    pick?: ClipImagePick,
  ): { ok: true; perImage: number; total: number } | { ok: false; code: ClipImageRefusal };
  /** Releases whatever is still held for the job (all images made, or the job ended). */
  release(jobId: string): Promise<void>;
  /**
   * Gives back AI image credits already recorded (the clip failed on the provider's side).
   * Resolves `false` when the ledger write failed, so the caller keeps its own record.
   */
  refund(
    req: ServerRequest,
    credits: number,
    conversationId?: string,
    pick?: ClipImagePick,
  ): Promise<boolean>;
}

export interface ClipImageServiceDeps {
  billing: MediaBilling;
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  fetch?: MediaFetch;
  /** The OpenRouter image catalogue; the shared one by default */
  catalogue?: () => readonly ImageCatalogueModel[] | undefined;
}

const REFUSALS: Record<'media_disabled' | 'paid_only' | 'not_in_pack', string> = {
  media_disabled: 'An admin turned image generation off for this account.',
  paid_only: 'AI images are part of paid packs; the user can buy one from «خرید اعتبار» (/payment).',
  not_in_pack: "The user's pack does not include image generation.",
};

type Slot = BalanceReservation | undefined;

const releaseAll = async (slots: Slot[]): Promise<void> => {
  await Promise.all(slots.splice(0).map((slot) => slot?.release()));
};

export function createClipImageService(deps: ClipImageServiceDeps): ClipImageService {
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  /** Tool-time holds by job id, released image by image as the job generates them. */
  const kept = new Map<string, { slots: Slot[]; timer: ReturnType<typeof setTimeout> }>();

  const catalogue = deps.catalogue ?? (() => getSharedImageModelCatalogue().getModels());

  /** The provider, model and price an image of this pick uses; a refusal code when none. */
  function setup(req: ServerRequest, pick?: ClipImagePick) {
    const config = getMediaConfig(req.config);
    if (!config) {
      return { kind: 'none' as const, code: 'unconfigured' as const };
    }
    const endpoint = resolveMediaEndpoint(req.config, config);
    if (pick?.source === 'higgsfield') {
      const higgsfield = config.higgsfield;
      if (!higgsfield) {
        return { kind: 'none' as const, code: 'unconfigured' as const };
      }
      const models = higgsfield.models.filter((item) => item.kind === 'image');
      const model = pick.modelId ? models.find((item) => item.id === pick.modelId) : models[0];
      if (!model) {
        return { kind: 'none' as const, code: 'unknown_model' as const };
      }
      /** Like the Higgsfield tool: `priceUsd` is the price charged, with no markup on top. */
      const estimate = mediaCredits(model.priceUsd, 1);
      return {
        kind: 'higgsfield' as const,
        config,
        higgsfield,
        model,
        estimate,
        billed: { model: model.id, endpoint: 'Higgsfield', context: MEDIA_TRANSACTION_CONTEXTS.higgsfield },
      };
    }
    const image = config.image;
    if (!image || !endpoint) {
      return { kind: 'none' as const, code: 'unconfigured' as const };
    }
    const models = listImageModels(image, catalogue());
    const model = pick?.modelId ? models.find((item) => item.id === pick.modelId) : models[0];
    if (!model) {
      return { kind: 'none' as const, code: 'unknown_model' as const };
    }
    const estimate = mediaCredits(model.estimateUsd, endpoint.priceMultiplier ?? 1);
    return {
      kind: 'openrouter' as const,
      config,
      image,
      endpoint,
      model,
      estimate,
      billed: { model: model.id, endpoint: config.endpoint, context: MEDIA_TRANSACTION_CONTEXTS.image },
    };
  }

  const charge = (billed: Omit<MediaCharge, 'conversationId'>, conversationId?: string): MediaCharge => ({
    ...billed,
    conversationId,
  });

  async function access(req: ServerRequest, config: TMediaGenerationConfig): Promise<MediaAccessResult> {
    const user = req.user as unknown as MediaUser | undefined;
    if (!user?.id) {
      return { ok: false, code: 'paid_only' };
    }
    return checkMediaAccess(config, user, deps.findBalanceByUser, getBalanceConfig(req.config)?.packs);
  }

  async function release(jobId: string): Promise<void> {
    const entry = kept.get(jobId);
    if (!entry) {
      return;
    }
    kept.delete(jobId);
    clearTimeout(entry.timer);
    await releaseAll(entry.slots);
  }

  return {
    async reserve(req, count, conversationId, options = {}) {
      const s = setup(req, options.pick);
      if (s.kind === 'none') {
        return {
          ok: false,
          code: s.code,
          message:
            s.code === 'unknown_model'
              ? 'That image model is not offered here.'
              : 'Image generation is not configured on this deployment.',
        };
      }
      if (!req.user?.id) {
        return { ok: false, code: 'not_allowed', message: 'No user.' };
      }
      const allowed = await access(req, s.config);
      if (!allowed.ok) {
        return { ok: false, code: 'not_allowed', message: REFUSALS[allowed.code] };
      }
      if (options.capCredits != null && options.capCredits > 0 && s.estimate * count > options.capCredits) {
        return {
          ok: false,
          code: 'cap_exceeded',
          message: `${count} AI image(s) are estimated at ${s.estimate * count} credits, over the spending cap of ${options.capCredits}.`,
        };
      }
      const slots: Slot[] = [];
      for (let i = 0; i < count; i++) {
        const held = await deps.billing.hold(req, charge(s.billed, conversationId), s.estimate);
        if (held === 'insufficient') {
          await releaseAll(slots);
          return {
            ok: false,
            code: 'insufficient_credit',
            message: `The user's credit does not cover ${count} AI image(s) (about $${((s.estimate * count) / 1e6).toFixed(2)}). Tell the user to top up from «خرید اعتبار» (/payment).`,
          };
        }
        slots.push(held);
      }
      return {
        ok: true,
        hold: {
          keep(jobId, untilMs) {
            const timer = setTimeout(() => void release(jobId), Math.max(0, untilMs - Date.now()));
            timer.unref?.();
            kept.set(jobId, { slots, timer });
          },
          release: () => releaseAll(slots),
        },
      };
    },

    async generate(req, prompt, aspectRatio, options = {}) {
      const s = setup(req, options.pick);
      if (s.kind === 'none') {
        return { ok: false, code: s.code };
      }
      if (!(await access(req, s.config)).ok) {
        return { ok: false, code: 'not_allowed' };
      }
      const entry = options.jobId ? kept.get(options.jobId) : undefined;
      await entry?.slots.pop()?.release();
      const target = charge(s.billed, options.conversationId);
      const held = await deps.billing.hold(req, target, s.estimate);
      if (held === 'insufficient') {
        return { ok: false, code: 'insufficient_credit' };
      }
      try {
        let made: { buffer: Buffer; type: string; costUsd?: number };
        let multiplier = 1;
        if (s.kind === 'higgsfield') {
          made = await generateHiggsfield(doFetch, s.higgsfield, {
            model: s.model,
            input: { prompt, aspect_ratio: aspectRatio },
            idempotencyKey: randomUUID(),
            pollIntervalMs: s.higgsfield.pollIntervalMs,
            timeoutMs: s.higgsfield.timeoutMs,
          });
          made = { ...made, costUsd: s.model.priceUsd };
        } else {
          multiplier = s.endpoint.priceMultiplier ?? 1;
          made = await generateOpenRouterImage(doFetch, s.endpoint, {
            model: s.model.id,
            prompt,
            aspectRatio,
            resolution: s.image.resolution,
            user: req.user?.id,
            timeoutMs: s.image.timeoutMs,
          });
        }
        const credits =
          options.alreadyCharged ??
          mediaCredits(made.costUsd ?? (s.kind === 'higgsfield' ? s.model.priceUsd : s.model.estimateUsd), multiplier);
        if (options.alreadyCharged == null) {
          await options.beforeRecord?.(credits);
          await deps.billing.record(req, target, credits);
        }
        return { ok: true, buffer: made.buffer, type: made.type, credits };
      } finally {
        await held?.release();
      }
    },

    models(req) {
      const config = getMediaConfig(req.config);
      if (!config) {
        return [];
      }
      const out: TClipWizardImageModel[] = [];
      const base = setup(req);
      if (base.kind === 'openrouter') {
        const multiplier = base.endpoint.priceMultiplier ?? 1;
        for (const model of listImageModels(base.image, catalogue())) {
          out.push({
            id: model.id,
            label: model.name ?? model.id,
            source: 'openrouter',
            credits: mediaCredits(model.estimateUsd, multiplier),
          });
        }
      }
      for (const model of config.higgsfield?.models ?? []) {
        if (model.kind === 'image') {
          out.push({ id: model.id, label: model.label, source: 'higgsfield', credits: mediaCredits(model.priceUsd, 1) });
        }
      }
      return out;
    },

    estimate(req, count, pick) {
      const s = setup(req, pick);
      if (s.kind === 'none') {
        return { ok: false as const, code: s.code };
      }
      return { ok: true as const, perImage: s.estimate, total: s.estimate * count };
    },

    async refund(req, credits, conversationId, pick) {
      const s = setup(req, pick);
      if (s.kind === 'none') {
        return false;
      }
      return deps.billing.refund(req, charge(s.billed, conversationId), credits);
    },

    release,
  };
}

const PEXELS_ORIENTATION: Record<ClipAspectRatio, string> = {
  '9:16': 'portrait',
  '4:5': 'portrait',
  '1:1': 'square',
  '16:9': 'landscape',
};

/**
 * One Pexels photo for a query, or null when nothing matched. Pexels asks for a visible credit
 * to the photographer and Pexels; the clip draws «Photo: <name> / Pexels» on the scene.
 */
export async function searchPexelsPhoto(
  doFetch: MediaFetch,
  apiKey: string,
  query: string,
  aspectRatio: ClipAspectRatio,
): Promise<{ buffer: Buffer; type: string; credit: string } | null> {
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '1');
  url.searchParams.set('orientation', PEXELS_ORIENTATION[aspectRatio]);
  const response = await doFetch(url.toString(), {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`pexels search answered ${response.status}`);
  }
  const body = (await response.json()) as {
    photos?: Array<{ photographer?: string; src?: { large2x?: string; large?: string } }>;
  };
  const photo = body.photos?.[0];
  const src = photo?.src?.large2x ?? photo?.src?.large;
  if (!photo || !src || !/^https:\/\/images\.pexels\.com\//.test(src)) {
    return null;
  }
  const image = await doFetch(src, { signal: AbortSignal.timeout(30_000) });
  if (!image.ok) {
    throw new Error(`pexels image answered ${image.status}`);
  }
  const type = image.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
  return {
    buffer: Buffer.from(await image.arrayBuffer()),
    type,
    credit: `Photo: ${(photo.photographer ?? 'Pexels').slice(0, 50)} / Pexels`,
  };
}

/** The Pexels key when stock photos are on; null otherwise. */
export function pexelsKey(
  enabled: boolean,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env.PEXELS_API_KEY?.trim();
  return enabled && key ? key : null;
}
