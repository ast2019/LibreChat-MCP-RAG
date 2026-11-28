import { logger } from '@librechat/data-schemas';
import { clipWizardStyleSampleRequestSchema } from 'librechat-data-provider';
import type { TClipToolsConfig, TClipWizardStyleSampleResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ClipVoiceSampleStore } from './types';
import type { ServerRequest } from '~/types';
import { CLIP_THEMES, isClipTheme } from '../themes';
import { stillsFailure, stillsOf } from './preview';
import { parseClipInput } from '../scene';
import { openWizard } from './access';
import { fail } from './types';

/** The fixed sample every built-in style is rendered from: one headline in both scripts. */
export const STYLE_SAMPLE_SCENE = {
  type: 'hook',
  duration_sec: 3,
  headline: 'سلام دنیا',
  subline: 'Hello world',
  kicker: 'HiveGPT',
} as const;

type Sample = { mime: string; base64: string };
type StyleDeps = Pick<
  ClipWizardDeps,
  'findBalanceByUser' | 'env' | 'images' | 'voiceSamples' | 'stills'
>;
type Made = { sample: Sample | null; error?: unknown };
type Reply = WizardReply<TClipWizardStyleSampleResponse | WizardErrorBody>;

/** After a failed render a style is not retried for this long. */
export const STYLE_RETRY_MS: number = 60 * 1000;
/** How often a config request may start a background pass over the styles that lack a sample. */
export const STYLE_WARM_EVERY_MS: number = 10 * 60 * 1000;
/** Changing the sample scene makes a new key, so old stored thumbnails are not served. */
const THEME_KEY_VERSION = 'v1';

export interface StyleSampler {
  /**
   * A built-in style: the stored picture, rendered from sample text on the worker (and stored)
   * when missing. An AI image model: the stored picture only, never generated on a request.
   */
  sample: (req: ServerRequest, deps: StyleDeps) => Promise<Reply>;
  /** Whether a stored sample exists for each AI image model id (read only, no generation). */
  imageSamples: (deps: StyleDeps, ids: string[]) => Promise<Set<string>>;
  /** Renders every missing style one at a time in the background; never throws. */
  warm: (req: ServerRequest, deps: StyleDeps) => Promise<void>;
}

export const themeSampleKey = (theme: string): string => `theme|${theme}|${THEME_KEY_VERSION}`;
export const imageSampleKey = (modelId: string): string => `image|${modelId}`;

/**
 * Thumbnails of the built-in styles, rendered once with `renderStill` on the render worker from
 * {@link STYLE_SAMPLE_SCENE}, kept in the shared sample store and memoised in the process. The
 * platform pays nothing per request and the user is never charged. A failed render is not retried
 * for {@link STYLE_RETRY_MS}.
 */
export function createStyleSampler(now: () => number = () => Date.now()): StyleSampler {
  const memo = new Map<string, Sample>();
  const memoryStore = new Map<string, Sample>();
  const retryAt = new Map<string, number>();
  const inflight = new Map<string, Promise<Made>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastWarm = 0;
  let warming = false;

  const fallbackStore: ClipVoiceSampleStore = {
    find: async (key) => memoryStore.get(key) ?? null,
    save: async (sample) => {
      memoryStore.set(sample.key, { mime: sample.mime, base64: sample.base64 });
    },
  };
  const storeOf = (deps: StyleDeps): ClipVoiceSampleStore => deps.voiceSamples ?? fallbackStore;

  async function stored(deps: StyleDeps, key: string): Promise<Sample | null> {
    const hit = memo.get(key);
    if (hit) {
      return hit;
    }
    try {
      const found = await storeOf(deps).find(key);
      if (found) {
        const sample = { mime: found.mime, base64: found.base64 };
        memo.set(key, sample);
        return sample;
      }
    } catch (error) {
      logger.error(`[clip] style sample store read failed key=${key}`, error);
    }
    return null;
  }

  /** Renders the sample scene in `theme`; throws what the worker threw. */
  async function render(deps: StyleDeps, config: TClipToolsConfig, theme: string): Promise<Sample> {
    const stills = stillsOf(deps);
    if (!stills) {
      throw new Error('render service not configured');
    }
    const parsed = parseClipInput(
      {
        title: 'Sample',
        theme,
        aspect_ratio: '16:9',
        scenes: [STYLE_SAMPLE_SCENE],
        audio: { mode: 'none' },
      },
      { ...config, aiImages: false },
    );
    if ('errors' in parsed) {
      throw new Error(`sample storyboard invalid: ${parsed.errors[0]}`);
    }
    const made = await stills({
      storyboard: parsed.storyboard,
      assets: {},
      audio: { mode: 'none' },
      shortSide: 540,
      maxDurationSec: config.maxDurationSec,
      timeoutMs: config.previewTimeoutSec * 1000,
      stills: 1,
    });
    const first = made.stills[0];
    if (!first) {
      throw new Error('worker returned no still');
    }
    return { mime: first.mime, base64: first.base64 };
  }

  function make(deps: StyleDeps, config: TClipToolsConfig, theme: string): Promise<Made> {
    const key = themeSampleKey(theme);
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
    /** One at a time: the worker has a single preview slot, and six thumbnails ask at once. */
    const attempt = async (): Promise<Made> => {
      try {
        const made = await render(deps, config, theme);
        memo.set(key, made);
        retryAt.delete(key);
        await storeOf(deps)
          .save({ key, ...made })
          .catch((error: unknown) =>
            logger.error(`[clip] style sample store write failed key=${key}`, error),
          );
        return { sample: made };
      } catch (error) {
        retryAt.set(key, now() + STYLE_RETRY_MS);
        logger.warn(
          `[clip] style sample failed key=${key}: ${error instanceof Error ? error.message : 'error'}`,
        );
        return { sample: null, error };
      } finally {
        inflight.delete(key);
      }
    };
    const work = queue.then(attempt);
    queue = work;
    inflight.set(key, work);
    return work;
  }

  async function sample(req: ServerRequest, deps: StyleDeps): Promise<Reply> {
    const gate = await openWizard(req, deps);
    if (!gate.ok) {
      return gate.reply;
    }
    const body = clipWizardStyleSampleRequestSchema.safeParse(req.body);
    if (!body.success) {
      return fail('invalid_request');
    }
    const { kind, id } = body.data;
    const served = (cached: boolean, hit: Sample): Reply => ({
      status: 200,
      body: { kind, id, ...hit, cached },
    });
    if (kind === 'image') {
      const model = deps.images?.models?.(req).find((item) => item.id === id);
      const hit = model ? await stored(deps, imageSampleKey(id)) : null;
      return hit ? served(true, hit) : fail('no_sample');
    }
    if (!isClipTheme(id)) {
      return fail('invalid_request');
    }
    const key = themeSampleKey(id);
    const hit = await stored(deps, key);
    if (hit) {
      return served(true, hit);
    }
    if (!inflight.has(key) && (retryAt.get(key) ?? 0) > now()) {
      return fail('provider_failed');
    }
    const made = await make(deps, gate.config, id);
    if (made.sample) {
      return served(false, made.sample);
    }
    return stillsFailure(made.error);
  }

  async function imageSamples(deps: StyleDeps, ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const id of ids) {
      if (await stored(deps, imageSampleKey(id))) {
        found.add(id);
      }
    }
    return found;
  }

  async function warm(req: ServerRequest, deps: StyleDeps): Promise<void> {
    if (warming || now() - lastWarm < STYLE_WARM_EVERY_MS || !stillsOf(deps)) {
      return;
    }
    warming = true;
    lastWarm = now();
    try {
      const gate = await openWizard(req, deps);
      if (!gate.ok) {
        return;
      }
      for (const theme of CLIP_THEMES) {
        const key = themeSampleKey(theme);
        if (!(await stored(deps, key)) && (retryAt.get(key) ?? 0) <= now()) {
          await make(deps, gate.config, theme);
        }
      }
    } catch (error) {
      logger.error('[clip] style sample warm-up failed', error);
    } finally {
      warming = false;
    }
  }

  return { sample, imageSamples, warm };
}
