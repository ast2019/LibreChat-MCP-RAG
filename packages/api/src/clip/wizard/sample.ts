import { logger } from '@librechat/data-schemas';
import { clipWizardVoiceSampleRequestSchema } from 'librechat-data-provider';
import type { TClipWizardVoiceSampleResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ClipVoiceSampleStore } from './types';
import type { ServerRequest } from '~/types';
import { createRemotionServiceClient } from '../client';
import { getRemotionServiceTarget } from '../config';
import type { ClipVoiceChoice } from '../voices';
import { resolveClipVoice } from '../voices';
import { openWizard } from './access';
import { fail } from './types';

/** The fixed line every sample speaks: short, so one sample costs about one narration call. */
export const SAMPLE_TEXT: Record<'fa' | 'en', string> = {
  fa: 'سلام، این نمونه‌ای از صدای من برای روایت کلیپ شماست.',
  en: 'Hello, this is a sample of my voice for your clip.',
};

type Sample = { mime: string; base64: string };
type SampleDeps = Pick<
  ClipWizardDeps,
  'findBalanceByUser' | 'narration' | 'voiceSamples' | 'env' | 'speakEdge'
>;
type Reply = WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>;

/** After a failed sample (a bad provider token, the worker down) the voice is not retried for this long. */
export const SAMPLE_RETRY_MS: number = 60 * 1000;
/** How often a config request may start a background pass over the voices that still lack a sample. */
export const SAMPLE_WARM_EVERY_MS: number = 10 * 60 * 1000;

export interface VoiceSampler {
  /** Serves the stored sample of a voice, making and storing it first when missing. */
  sample: (req: ServerRequest, deps: SampleDeps) => Promise<Reply>;
  /**
   * Makes every missing sample one at a time, in the background. A failure is logged and skipped
   * (it never throws, so a bad token cannot break the request that started it); the next pass
   * retries it, at most once per {@link SAMPLE_WARM_EVERY_MS}.
   */
  warm: (req: ServerRequest, deps: SampleDeps) => Promise<void>;
}

/**
 * Voice samples for every voice, made once and kept. The platform pays: an OpenRouter sample
 * is made without a hold or a ledger row, and an Edge sample is free (the worker speaks it).
 * Samples are stored through `deps.voiceSamples` (a collection, so they survive a restart) and
 * memoised in the process. The key holds provider, model, voice and language, so a changed
 * config makes a new sample.
 *
 * A failed make is not retried for {@link SAMPLE_RETRY_MS} and answers `provider_failed`, so a
 * bad token does not hammer the provider, and a corrected one works within a minute.
 */
export function createVoiceSampler(now: () => number = () => Date.now()): VoiceSampler {
  const memo = new Map<string, Sample>();
  const memoryStore = new Map<string, Sample>();
  const retryAt = new Map<string, number>();
  const inflight = new Map<string, Promise<Sample | null>>();
  let lastWarm = 0;
  let warming = false;

  const fallbackStore: ClipVoiceSampleStore = {
    find: async (key) => memoryStore.get(key) ?? null,
    save: async (sample) => {
      memoryStore.set(sample.key, { mime: sample.mime, base64: sample.base64 });
    },
  };

  const keyOf = (choice: ClipVoiceChoice, lang: 'fa' | 'en'): string =>
    choice.provider === 'openrouter'
      ? `openrouter|${choice.model}|${choice.voice}|${lang}`
      : `edge|${choice.voice ?? ''}|${lang}`;

  async function stored(deps: SampleDeps, key: string): Promise<Sample | null> {
    const hit = memo.get(key);
    if (hit) {
      return hit;
    }
    try {
      const found = await (deps.voiceSamples ?? fallbackStore).find(key);
      if (found) {
        const sample = { mime: found.mime, base64: found.base64 };
        memo.set(key, sample);
        return sample;
      }
    } catch (error) {
      logger.error(`[clip] voice sample store read failed key=${key}`, error);
    }
    return null;
  }

  async function speak(
    req: ServerRequest,
    deps: SampleDeps,
    choice: ClipVoiceChoice,
    lang: 'fa' | 'en',
  ): Promise<Sample> {
    const text = SAMPLE_TEXT[lang];
    if (choice.provider === 'edge') {
      if (deps.speakEdge) {
        return deps.speakEdge({ text, lang, ...(choice.voice ? { voice: choice.voice } : {}) });
      }
      const target = getRemotionServiceTarget(deps.env ?? process.env);
      if (!target) {
        throw new Error('render service not configured');
      }
      return createRemotionServiceClient(target).speak({
        text,
        lang,
        ...(choice.voice ? { voice: choice.voice } : {}),
      });
    }
    if (!deps.narration) {
      throw new Error('narration not wired');
    }
    const made = await deps.narration.generate(req, text, choice, { chargeUser: false });
    if (!made.ok) {
      throw new Error(`narration ${made.code}`);
    }
    return { mime: made.type, base64: made.buffer.toString('base64') };
  }

  /** Makes and stores one sample; null (and a retry time) when the provider failed. */
  function make(
    req: ServerRequest,
    deps: SampleDeps,
    key: string,
    choice: ClipVoiceChoice,
    lang: 'fa' | 'en',
  ): Promise<Sample | null> {
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
    const work = (async (): Promise<Sample | null> => {
      try {
        const made = await speak(req, deps, choice, lang);
        memo.set(key, made);
        retryAt.delete(key);
        await (deps.voiceSamples ?? fallbackStore)
          .save({ key, ...made })
          .catch((error: unknown) =>
            logger.error(`[clip] voice sample store write failed key=${key}`, error),
          );
        return made;
      } catch (error) {
        retryAt.set(key, now() + SAMPLE_RETRY_MS);
        logger.warn(
          `[clip] voice sample failed key=${key}: ${error instanceof Error ? error.message : 'error'}`,
        );
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, work);
    return work;
  }

  async function sample(req: ServerRequest, deps: SampleDeps): Promise<Reply> {
    const gate = await openWizard(req, deps);
    if (!gate.ok) {
      return gate.reply;
    }
    const body = clipWizardVoiceSampleRequestSchema.safeParse(req.body);
    if (!body.success) {
      return fail('invalid_request');
    }
    const { voiceId } = body.data;
    const entry = gate.config.voices.find((item) => item.id === voiceId);
    if (!entry) {
      return fail('invalid_request');
    }
    const resolved = resolveClipVoice(gate.config, voiceId, entry.lang);
    if (!resolved.ok) {
      return fail('no_sample');
    }
    const key = keyOf(resolved.choice, entry.lang);
    const served = (cached: boolean, hit: Sample): Reply => ({
      status: 200,
      body: { voiceId, ...hit, cached },
    });
    const hit = await stored(deps, key);
    if (hit) {
      return served(true, hit);
    }
    if (!inflight.has(key) && (retryAt.get(key) ?? 0) > now()) {
      return fail('provider_failed');
    }
    const made = await make(req, deps, key, resolved.choice, entry.lang);
    return made ? served(false, made) : fail('provider_failed');
  }

  async function warm(req: ServerRequest, deps: SampleDeps): Promise<void> {
    if (warming || now() - lastWarm < SAMPLE_WARM_EVERY_MS) {
      return;
    }
    warming = true;
    lastWarm = now();
    try {
      const gate = await openWizard(req, deps);
      if (!gate.ok) {
        return;
      }
      for (const entry of gate.config.voices) {
        const resolved = resolveClipVoice(gate.config, entry.id, entry.lang);
        if (!resolved.ok || (resolved.choice.provider === 'openrouter' && !deps.narration)) {
          continue;
        }
        const key = keyOf(resolved.choice, entry.lang);
        if (!(await stored(deps, key)) && (retryAt.get(key) ?? 0) <= now()) {
          await make(req, deps, key, resolved.choice, entry.lang);
        }
      }
    } catch (error) {
      logger.error('[clip] voice sample warm-up failed', error);
    } finally {
      warming = false;
    }
  }

  return { sample, warm };
}
