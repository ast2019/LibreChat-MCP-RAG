import { logger } from '@librechat/data-schemas';
import { clipWizardVoiceSampleRequestSchema } from 'librechat-data-provider';
import type { TClipWizardVoiceSampleResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { resolveClipVoice } from '../voices';
import { openWizard } from './access';
import { fail } from './types';

/** The fixed line every sample speaks: short, so one sample costs about one narration call. */
export const SAMPLE_TEXT: Record<'fa' | 'en', string> = {
  fa: 'سلام، این نمونه‌ای از صدای من برای روایت کلیپ شماست.',
  en: 'Hello, this is a sample of my voice for your clip.',
};

type Sample = { mime: string; base64: string };

/** How long a made sample is served; a changed voice or model config shows up within a day. */
export const SAMPLE_TTL_MS: number = 24 * 60 * 60 * 1000;

/**
 * Voice samples. The first sample of a voice is paid for by the user who asked and kept in
 * memory; everyone after gets it free. Provider failures charge nothing (the narration service
 * gives back what it recorded and releases its hold).
 *
 * The cache is per process (each instance charges one more user for its own copy) and entries
 * expire after {@link SAMPLE_TTL_MS}. The key holds model, voice and language, so a changed
 * config makes a new sample. With `wizard.sampleCharge: 'platform'` nobody is charged: the call
 * is made without a hold or a ledger row, and the provider cost is the platform's.
 */
export function createVoiceSampler(
  now: () => number = () => Date.now(),
): (
  req: ServerRequest,
  deps: Pick<ClipWizardDeps, 'findBalanceByUser' | 'narration'>,
) => Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>> {
  const cache = new Map<string, Sample & { at: number }>();
  const inflight = new Map<string, Promise<unknown>>();

  return async function sample(
    req: ServerRequest,
    deps: Pick<ClipWizardDeps, 'findBalanceByUser' | 'narration'>,
  ): Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>> {
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
    if (!resolved.ok || resolved.choice.provider !== 'openrouter') {
      return fail('no_sample');
    }
    const choice = resolved.choice;
    const key = `${choice.model}|${choice.voice}|${entry.lang}`;
    const served = (cached: boolean, hit: Sample): WizardReply<TClipWizardVoiceSampleResponse> => ({
      status: 200,
      body: { voiceId, ...hit, cached },
    });

    /**
     * Another request is making this sample: wait, then use its result if it made one. The call
     * removes itself from `inflight` before it settles, so after a failure the first waiter to
     * wake starts the next call and the others wait on that one.
     */
    for (let pending = inflight.get(key); pending; pending = inflight.get(key)) {
      await pending.catch(() => undefined);
      const made = cache.get(key);
      if (made && now() - made.at < SAMPLE_TTL_MS) {
        return served(true, made);
      }
    }
    const hit = cache.get(key);
    if (hit && now() - hit.at < SAMPLE_TTL_MS) {
      return served(true, hit);
    }
    cache.delete(key);
    if (!deps.narration) {
      return fail('unavailable');
    }
    const narration = deps.narration;
    const work = (async (): Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>> => {
      try {
        const made = await narration.generate(req, SAMPLE_TEXT[entry.lang], choice, {
          chargeUser: gate.config.wizard.sampleCharge !== 'platform',
        });
        if (!made.ok) {
          return fail(
            made.code === 'insufficient_credit'
              ? 'insufficient_credit'
              : made.code === 'unconfigured'
                ? 'unavailable'
                : 'not_allowed',
          );
        }
        const stored = { mime: made.type, base64: made.buffer.toString('base64') };
        cache.set(key, { ...stored, at: now() });
        return served(false, stored);
      } catch (error) {
        logger.error(`[clip] wizard voice sample failed voice=${voiceId}`, error);
        return fail('provider_failed');
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, work);
    return work;
  };
}
