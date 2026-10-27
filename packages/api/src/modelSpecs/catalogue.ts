import { z } from 'zod';
import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, extractEnvVariable, normalizeEndpointName } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { AxiosRequestConfig } from 'axios';
import type { CatalogueModel, ModelCatalogueSnapshot } from './discover';
import { applyAxiosProxyConfig } from '~/utils/proxy';

/** Where the catalogue is read from: an OpenRouter-compatible API root. */
export interface ModelCatalogueSource {
  baseURL: string;
  apiKey?: string;
  timeoutMs: number;
}

export type FetchCatalogueJson = (
  url: string,
  options: { headers: Record<string, string>; timeout: number },
) => Promise<unknown>;

export interface ModelCatalogue {
  /** The last fetched catalogue; `undefined` before any list was fetched. */
  getSnapshot: () => ModelCatalogueSnapshot | undefined;
  /** Fetches both lists; a failed list keeps its previous value. Never rejects. */
  refresh: (source: ModelCatalogueSource) => Promise<void>;
  /**
   * Refreshes now and every `intervalMs` (unref'd timer, so it never holds the process open).
   * A second call replaces the source and interval.
   */
  start: (source: ModelCatalogueSource, intervalMs: number) => Promise<void>;
  stop: () => void;
}

const modelsSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        name: z.string().optional().catch(undefined),
        created: z.number().optional().catch(undefined),
        architecture: z
          .object({ input_modalities: z.array(z.string()).optional().catch(undefined) })
          .passthrough()
          .optional()
          .catch(undefined),
      })
      .passthrough(),
  ),
});

const zdrSchema = z.object({
  data: z.array(z.object({ model_id: z.string() }).passthrough()),
});

const defaultFetchJson: FetchCatalogueJson = async (url, options) => {
  const config: AxiosRequestConfig = { headers: options.headers, timeout: options.timeout };
  applyAxiosProxyConfig(config, url);
  const response = await axios.get(url, config);
  return response.data;
};

/**
 * The catalogue source for `modelSpecs.autoDiscover`: the base URL and admin key of its
 * `endpoint`. `null` when discovery is off or the endpoint has no usable base URL; a key the
 * deployment does not hold (`user_provided`, an unset `${VAR}`) is left out, since the
 * catalogue routes are public.
 */
export function resolveModelCatalogueSource(
  appConfig: AppConfig | null | undefined,
): ModelCatalogueSource | null {
  const settings = appConfig?.modelSpecs?.autoDiscover;
  if (settings?.enabled !== true) {
    return null;
  }
  const name = normalizeEndpointName(settings.endpoint ?? 'OpenRouter');
  const custom = (appConfig?.endpoints?.[EModelEndpoint.custom] ?? []) as Array<{
    name?: string;
    baseURL?: string;
    apiKey?: string;
  }>;
  const endpoint = custom.find((entry) => normalizeEndpointName(entry?.name) === name);
  const baseURL = endpoint?.baseURL ? extractEnvVariable(endpoint.baseURL) : '';
  if (!baseURL || baseURL.includes('${') || !/^https?:\/\//i.test(baseURL)) {
    return null;
  }
  const key = endpoint?.apiKey ? extractEnvVariable(endpoint.apiKey) : '';
  const apiKey = key && !key.includes('${') && key !== 'user_provided' ? key : undefined;
  return {
    baseURL: baseURL.replace(/\/+$/, ''),
    ...(apiKey && { apiKey }),
    timeoutMs: settings.timeoutMs ?? 15000,
  };
}

export function createModelCatalogue(
  deps: { fetchJson?: FetchCatalogueJson } = {},
): ModelCatalogue {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  let snapshot: ModelCatalogueSnapshot | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;

  async function readModels(source: ModelCatalogueSource, headers: Record<string, string>) {
    const data = await fetchJson(`${source.baseURL}/models`, {
      headers,
      timeout: source.timeoutMs,
    });
    const parsed = modelsSchema.parse(data);
    if (parsed.data.length === 0) {
      throw new Error('empty model list');
    }
    return parsed.data.map(({ id, name, created, architecture }): CatalogueModel => {
      const inputModalities = architecture?.input_modalities;
      return {
        id,
        ...(name != null && { name }),
        ...(created != null && { created }),
        ...(inputModalities != null && { inputModalities }),
      };
    });
  }

  async function readZdr(source: ModelCatalogueSource, headers: Record<string, string>) {
    const data = await fetchJson(`${source.baseURL}/endpoints/zdr`, {
      headers,
      timeout: source.timeoutMs,
    });
    const parsed = zdrSchema.parse(data);
    /** An empty list would read as "nothing is confidential" and drop every private spec */
    if (parsed.data.length === 0) {
      throw new Error('empty ZDR list');
    }
    return new Set(parsed.data.map((entry) => entry.model_id));
  }

  async function doRefresh(source: ModelCatalogueSource): Promise<void> {
    const headers: Record<string, string> = source.apiKey
      ? { Authorization: `Bearer ${source.apiKey}` }
      : {};
    const [models, zdr] = await Promise.allSettled([
      readModels(source, headers),
      readZdr(source, headers),
    ]);
    for (const [label, result] of [
      ['model list', models],
      ['ZDR list', zdr],
    ] as const) {
      if (result.status === 'rejected') {
        const reason = result.reason as { message?: string } | undefined;
        logger.warn(
          `[modelSpecs.autoDiscover] Could not refresh the ${label}; keeping the last one: ${reason?.message ?? 'unknown error'}`,
        );
      }
    }
    if (models.status === 'rejected' && zdr.status === 'rejected') {
      return;
    }
    snapshot = {
      version: (snapshot?.version ?? 0) + 1,
      models: models.status === 'fulfilled' ? models.value : (snapshot?.models ?? null),
      zdr: zdr.status === 'fulfilled' ? zdr.value : (snapshot?.zdr ?? null),
    };
    logger.info(
      `[modelSpecs.autoDiscover] Catalogue ready: ${snapshot.models?.length ?? 0} model(s), ${snapshot.zdr?.size ?? 0} with ZDR`,
    );
  }

  function refresh(source: ModelCatalogueSource): Promise<void> {
    inFlight ??= doRefresh(source)
      .catch((error: unknown) => {
        logger.warn('[modelSpecs.autoDiscover] Catalogue refresh failed:', error);
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

  function start(source: ModelCatalogueSource, intervalMs: number): Promise<void> {
    stop();
    timer = setInterval(() => void refresh(source), intervalMs);
    timer.unref?.();
    return refresh(source);
  }

  return { getSnapshot: () => snapshot, refresh, start, stop };
}

let sharedCatalogue: ModelCatalogue | undefined;

/**
 * The process-wide catalogue: the startup warm-up starts its refresh, and `getAppConfig`
 * reads its snapshot, so no request ever waits on the catalogue.
 */
export function getSharedModelCatalogue(): ModelCatalogue {
  sharedCatalogue ??= createModelCatalogue();
  return sharedCatalogue;
}

/** Catalogue lookups by id, built once per model list. */
const modelIndexes = new WeakMap<readonly CatalogueModel[], Map<string, CatalogueModel>>();

function findCatalogueModel(
  modelId: string,
  snapshot: ModelCatalogueSnapshot | undefined,
): CatalogueModel | undefined {
  const models = snapshot?.models;
  if (!models || !modelId) {
    return undefined;
  }
  let index = modelIndexes.get(models);
  if (!index) {
    index = new Map(models.map((model) => [model.id, model]));
    modelIndexes.set(models, index);
  }
  /** `~x-latest` aliases are catalogue entries of their own; a `:variant` suffix (`:free`,
   * `:online`, …) that is not listed falls back to its base model. */
  return index.get(modelId) ?? index.get(modelId.replace(/:[^/:]+$/, ''));
}

function modelAcceptsInput(
  modality: string,
  modelId: string,
  snapshot: ModelCatalogueSnapshot | undefined,
): boolean | undefined {
  const inputModalities = findCatalogueModel(modelId, snapshot)?.inputModalities;
  return inputModalities ? inputModalities.includes(modality) : undefined;
}

/**
 * Whether the catalogue lists `file` among the model's input modalities, i.e. it reads PDFs
 * natively. `undefined` when unknown: no catalogue yet, the model is not listed, or it lists no
 * modalities. Reads the shared catalogue unless a snapshot is given.
 */
export function modelAcceptsFiles(
  modelId: string,
  snapshot: ModelCatalogueSnapshot | undefined = getSharedModelCatalogue().getSnapshot(),
): boolean | undefined {
  return modelAcceptsInput('file', modelId, snapshot);
}

/** Like {@link modelAcceptsFiles}, for the `image` input modality. */
export function modelAcceptsImages(
  modelId: string,
  snapshot: ModelCatalogueSnapshot | undefined = getSharedModelCatalogue().getSnapshot(),
): boolean | undefined {
  return modelAcceptsInput('image', modelId, snapshot);
}
