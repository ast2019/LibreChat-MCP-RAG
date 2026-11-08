import type { TMediaImageConfig, TMediaImageModel } from 'librechat-data-provider';
import type { ImageCatalogueModel } from './catalogue';

/** A model id against a `*` pattern from the config; the whole id must match. */
export function matchesModelPattern(id: string, pattern: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(id);
}

const matchesAny = (id: string, patterns: readonly string[]) =>
  patterns.some((pattern) => matchesModelPattern(id, pattern));

/**
 * The USD held before a picture: the config's `estimates` entry, else the catalogue's price per
 * output token times `estimateTokens`, else `estimateUsd`. Only the hold uses it; the charge is
 * the real cost when the provider reports one.
 */
export function estimateImageUsd(
  image: TMediaImageConfig,
  modelId: string,
  catalogueModel?: ImageCatalogueModel,
): number {
  const configured = image.estimates[modelId];
  if (configured != null) {
    return configured;
  }
  if (catalogueModel?.imageOutputPrice != null && catalogueModel.imageOutputPrice > 0) {
    return catalogueModel.imageOutputPrice * image.estimateTokens;
  }
  return image.estimateUsd;
}

function describe(
  image: TMediaImageConfig,
  id: string,
  catalogueModel: ImageCatalogueModel | undefined,
): TMediaImageModel {
  return {
    id,
    ...(catalogueModel?.name != null && { name: catalogueModel.name }),
    persianText: matchesAny(id, image.persianText),
    estimateUsd: estimateImageUsd(image, id, catalogueModel),
    ...(catalogueModel != null && { editing: catalogueModel.acceptsImages }),
    ...(id === image.model && { default: true }),
  };
}

/**
 * Every image model the user may pick: the default first, then the Persian-text models, then
 * the rest by name. Without the catalogue (off, or not read yet) only the default.
 */
export function listImageModels(
  image: TMediaImageConfig,
  catalogue: readonly ImageCatalogueModel[] | undefined,
): TMediaImageModel[] {
  const byId = new Map((catalogue ?? []).map((model) => [model.id, model]));
  const defaultModel = describe(image, image.model, byId.get(image.model));
  if (!image.catalogue || !catalogue) {
    return [defaultModel];
  }
  const others = catalogue
    .filter((model) => model.id !== image.model && !matchesAny(model.id, image.exclude))
    .map((model) => describe(image, model.id, model))
    .sort(
      (a, b) =>
        Number(b.persianText) - Number(a.persianText) ||
        (a.name ?? a.id).localeCompare(b.name ?? b.id),
    );
  return [defaultModel, ...others];
}

export type ImageModelChoice =
  | { ok: true; model: TMediaImageModel }
  | { ok: false; code: 'unknown_model'; suggestions: string[] };

const words = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);

/**
 * The model one picture uses. `requested` is an exact id or a name the user typed; an empty
 * request takes the default. A request that matches nothing returns the closest ids, so the
 * model can ask the user instead of guessing.
 */
export function resolveImageModel(
  models: readonly TMediaImageModel[],
  requested: string | null | undefined,
): ImageModelChoice {
  const wanted = requested?.trim();
  const fallback = models.find((model) => model.default) ?? models[0];
  if (!wanted) {
    return fallback
      ? { ok: true, model: fallback }
      : { ok: false, code: 'unknown_model', suggestions: [] };
  }
  const lower = wanted.toLowerCase();
  const exact = models.find(
    (model) => model.id.toLowerCase() === lower || model.name?.toLowerCase() === lower,
  );
  if (exact) {
    return { ok: true, model: exact };
  }
  const terms = words(wanted);
  const scored = models
    .map((model) => {
      const haystack = `${model.id} ${model.name ?? ''}`.toLowerCase();
      return { model, hits: terms.filter((term) => haystack.includes(term)).length };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = scored[0]?.hits ?? 0;
  const top = scored.filter((entry) => entry.hits === best);
  if (top.length === 1 && best === terms.length) {
    return { ok: true, model: top[0].model };
  }
  return {
    ok: false,
    code: 'unknown_model',
    suggestions: (best > 0 ? top : scored).slice(0, 6).map((entry) => entry.model.id),
  };
}
