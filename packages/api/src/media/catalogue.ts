import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import type { FetchCatalogueJson } from '~/modelSpecs/catalogue';
import { defaultFetchJson } from '~/modelSpecs/catalogue';

/** One image model from the endpoint's catalogue. */
export interface ImageCatalogueModel {
  id: string;
  name?: string;
  /** USD per output image token, when the catalogue lists one */
  imageOutputPrice?: number;
  /** Takes images as input, so it can edit or follow references */
  acceptsImages: boolean;
}

export interface ImageCatalogueSource {
  baseURL: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface ImageModelCatalogue {
  /** The last list read; `undefined` before the first read succeeds. */
  getModels: () => readonly ImageCatalogueModel[] | undefined;
  /** Reads the list again; a failed read keeps the previous one. Never rejects. */
  refresh: (source: ImageCatalogueSource) => Promise<void>;
  /** Reads now and every `intervalMs` (an unref'd timer). A second call replaces both. */
  start: (source: ImageCatalogueSource, intervalMs: number) => Promise<void>;
  stop: () => void;
}

const price = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative())
  .optional()
  .catch(undefined);

const imageModelsSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        name: z.string().optional().catch(undefined),
        architecture: z
          .object({ input_modalities: z.array(z.string()).optional().catch(undefined) })
          .passthrough()
          .optional()
          .catch(undefined),
        pricing: z.object({ image_output: price }).passthrough().optional().catch(undefined),
        endpoints: z.array(z.string()).optional().catch(undefined),
      })
      .passthrough(),
  ),
});

/** OpenRouter's routers pick a model themselves, so the user would not know what made it. */
const ROUTER_PREFIX = 'openrouter/';

/** Image generation posts to `/images`; a model listed only for chat cannot be used there. */
const servesImages = (endpoints: string[] | undefined): boolean =>
  endpoints == null || endpoints.some((route) => /\/images\/?$/.test(route));

export function createImageModelCatalogue(
  deps: { fetchJson?: FetchCatalogueJson } = {},
): ImageModelCatalogue {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  let models: readonly ImageCatalogueModel[] | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;

  async function read(source: ImageCatalogueSource): Promise<ImageCatalogueModel[]> {
    const data = await fetchJson(`${source.baseURL}/models?output_modalities=image`, {
      headers: source.apiKey ? { Authorization: `Bearer ${source.apiKey}` } : {},
      timeout: source.timeoutMs,
    });
    const parsed = imageModelsSchema.parse(data);
    const list = parsed.data
      .filter((model) => !model.id.startsWith(ROUTER_PREFIX) && servesImages(model.endpoints))
      .map(
        (model): ImageCatalogueModel => ({
          id: model.id,
          ...(model.name != null && { name: model.name }),
          ...(model.pricing?.image_output != null && {
            imageOutputPrice: model.pricing.image_output,
          }),
          acceptsImages: model.architecture?.input_modalities?.includes('image') === true,
        }),
      );
    if (list.length === 0) {
      throw new Error('empty image model list');
    }
    return list;
  }

  function refresh(source: ImageCatalogueSource): Promise<void> {
    inFlight ??= read(source)
      .then((list) => {
        models = list;
        logger.info(`[media] Image model catalogue ready: ${list.length} model(s)`);
      })
      .catch((error: unknown) => {
        const reason = error as { message?: string } | undefined;
        logger.warn(
          `[media] Could not refresh the image model catalogue; keeping the last one: ${reason?.message ?? 'unknown error'}`,
        );
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function start(source: ImageCatalogueSource, intervalMs: number): Promise<void> {
    stop();
    timer = setInterval(() => void refresh(source), intervalMs);
    timer.unref?.();
    return refresh(source);
  }

  return { getModels: () => models, refresh, start, stop };
}

let sharedImageCatalogue: ImageModelCatalogue | undefined;

/** The process-wide image catalogue: the startup warm-up starts it, the media tools read it. */
export function getSharedImageModelCatalogue(): ImageModelCatalogue {
  sharedImageCatalogue ??= createImageModelCatalogue();
  return sharedImageCatalogue;
}
