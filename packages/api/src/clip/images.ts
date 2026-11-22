import { MEDIA_TRANSACTION_CONTEXTS } from 'librechat-data-provider';
import type { TMediaGenerationConfig } from 'librechat-data-provider';
import type { MediaBilling, MediaCharge } from '~/media/billing';
import type { MediaAccessResult } from '~/media/config';
import type { MediaFetch, MediaUser } from '~/media/types';
import type { BalanceReservation } from '~/middleware/checkBalance';
import type { ClipAspectRatio } from './scene';
import type { ServerRequest } from '~/types';
import { checkMediaAccess, getMediaConfig, resolveMediaEndpoint } from '~/media/config';
import { generateOpenRouterImage } from '~/media/providers';
import { listImageModels } from '~/media/models';
import { getBalanceConfig } from '~/app/config';
import { mediaCredits } from '~/media/billing';

/** Why an AI image was not generated (the job fails with a matching code). */
export type ClipImageRefusal = 'unconfigured' | 'not_allowed' | 'insufficient_credit';

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
  ): Promise<{ ok: true; hold: ClipImageHold } | { ok: false; message: string }>;
  /**
   * Generates one image and records its charge (provider cost, else the estimate). Access and
   * balance are checked again first: the user may have spent the credit or changed pack since
   * the tool call, and a refusal charges nothing. Throws when the provider fails.
   */
  generate(
    req: ServerRequest,
    prompt: string,
    aspectRatio: ClipAspectRatio,
    options?: { conversationId?: string; jobId?: string },
  ): Promise<ClipImageResult>;
  /** Releases whatever is still held for the job (all images made, or the job ended). */
  release(jobId: string): Promise<void>;
}

export interface ClipImageServiceDeps {
  billing: MediaBilling;
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  fetch?: MediaFetch;
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

  function setup(req: ServerRequest) {
    const config = getMediaConfig(req.config);
    const image = config?.image;
    const endpoint = config ? resolveMediaEndpoint(req.config, config) : undefined;
    if (!config || !image || !endpoint) {
      return null;
    }
    const model = listImageModels(image, undefined)[0];
    const estimate = mediaCredits(model.estimateUsd, endpoint.priceMultiplier ?? 1);
    return { config, image, endpoint, model, estimate };
  }

  const charge = (model: string, endpoint: string, conversationId?: string): MediaCharge => ({
    model,
    endpoint,
    context: MEDIA_TRANSACTION_CONTEXTS.image,
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
    async reserve(req, count, conversationId) {
      const s = setup(req);
      if (!s) {
        return { ok: false, message: 'Image generation is not configured on this deployment.' };
      }
      if (!req.user?.id) {
        return { ok: false, message: 'No user.' };
      }
      const allowed = await access(req, s.config);
      if (!allowed.ok) {
        return { ok: false, message: REFUSALS[allowed.code] };
      }
      const slots: Slot[] = [];
      for (let i = 0; i < count; i++) {
        const held = await deps.billing.hold(req, charge(s.model.id, s.config.endpoint, conversationId), s.estimate);
        if (held === 'insufficient') {
          await releaseAll(slots);
          return {
            ok: false,
            message: `The user's credit does not cover ${count} AI image(s) (about $${((s.estimate * count) / 1e6).toFixed(2)}).`,
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
      const s = setup(req);
      if (!s) {
        return { ok: false, code: 'unconfigured' };
      }
      if (!(await access(req, s.config)).ok) {
        return { ok: false, code: 'not_allowed' };
      }
      const entry = options.jobId ? kept.get(options.jobId) : undefined;
      await entry?.slots.pop()?.release();
      const target = charge(s.model.id, s.config.endpoint, options.conversationId);
      const held = await deps.billing.hold(req, target, s.estimate);
      if (held === 'insufficient') {
        return { ok: false, code: 'insufficient_credit' };
      }
      try {
        const generated = await generateOpenRouterImage(doFetch, s.endpoint, {
          model: s.model.id,
          prompt,
          aspectRatio,
          resolution: s.image.resolution,
          user: req.user?.id,
          timeoutMs: s.image.timeoutMs,
        });
        const multiplier = s.endpoint.priceMultiplier ?? 1;
        const credits = mediaCredits(generated.costUsd ?? s.model.estimateUsd, multiplier);
        await deps.billing.record(req, target, credits);
        return { ok: true, buffer: generated.buffer, type: generated.type, credits };
      } finally {
        await held?.release();
      }
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
