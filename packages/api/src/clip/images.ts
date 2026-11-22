import { MEDIA_TRANSACTION_CONTEXTS } from 'librechat-data-provider';
import type { MediaBilling, MediaCharge } from '~/media/billing';
import type { MediaFetch, MediaUser } from '~/media/types';
import type { BalanceReservation } from '~/middleware/checkBalance';
import type { ClipAspectRatio } from './scene';
import type { ServerRequest } from '~/types';
import { checkMediaAccess, getMediaConfig, resolveMediaEndpoint } from '~/media/config';
import { generateOpenRouterImage } from '~/media/providers';
import { listImageModels } from '~/media/models';
import { getBalanceConfig } from '~/app/config';
import { mediaCredits } from '~/media/billing';

/** AI images for a clip go through the image tool's path: same access rule, model and ledger. */
export interface ClipImageService {
  /**
   * Checks media access and holds the estimate for `count` images, so a user cannot start a
   * clip they cannot pay for. The caller releases the hold once the job is recorded; each image
   * is charged when the job generates it.
   */
  reserve(
    req: ServerRequest,
    count: number,
    conversationId?: string,
  ): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; message: string }>;
  /** Generates one image and records its charge (provider cost, else the estimate). */
  generate(
    req: ServerRequest,
    prompt: string,
    aspectRatio: ClipAspectRatio,
    conversationId?: string,
  ): Promise<{ buffer: Buffer; type: string; credits: number }>;
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

export function createClipImageService(deps: ClipImageServiceDeps): ClipImageService {
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));

  function setup(req: ServerRequest) {
    const config = getMediaConfig(req.config);
    const image = config?.image;
    const endpoint = config ? resolveMediaEndpoint(req.config, config) : undefined;
    if (!config || !image || !endpoint) {
      return null;
    }
    const model = listImageModels(image, undefined)[0];
    return { config, image, endpoint, model };
  }

  const charge = (model: string, endpoint: string, conversationId?: string): MediaCharge => ({
    model,
    endpoint,
    context: MEDIA_TRANSACTION_CONTEXTS.image,
    conversationId,
  });

  return {
    async reserve(req, count, conversationId) {
      const s = setup(req);
      if (!s) {
        return { ok: false, message: 'Image generation is not configured on this deployment.' };
      }
      const user = req.user as unknown as MediaUser | undefined;
      if (!user?.id) {
        return { ok: false, message: 'No user.' };
      }
      const access = await checkMediaAccess(
        s.config,
        user,
        deps.findBalanceByUser,
        getBalanceConfig(req.config)?.packs,
      );
      if (!access.ok) {
        return { ok: false, message: REFUSALS[access.code] };
      }
      const estimate = mediaCredits(s.model.estimateUsd * count, s.endpoint.priceMultiplier ?? 1);
      const held: BalanceReservation | 'insufficient' | undefined = await deps.billing.hold(
        req,
        charge(s.model.id, s.config.endpoint, conversationId),
        estimate,
      );
      if (held === 'insufficient') {
        return {
          ok: false,
          message: `The user's credit does not cover ${count} AI image(s) (about $${(estimate / 1e6).toFixed(2)}).`,
        };
      }
      return { ok: true, release: async () => void (await held?.release()) };
    },

    async generate(req, prompt, aspectRatio, conversationId) {
      const s = setup(req);
      if (!s) {
        throw new Error('image generation is not configured');
      }
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
      await deps.billing.record(req, charge(s.model.id, s.config.endpoint, conversationId), credits);
      return { buffer: generated.buffer, type: generated.type, credits };
    },
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
