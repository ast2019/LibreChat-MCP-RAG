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

/**
 * Voice samples. The first sample of a voice is paid for by the user who asked and kept in
 * memory; everyone after gets it free. Provider failures charge nothing (the narration service
 * gives back what it recorded and releases its hold).
 */
export function createVoiceSampler() {
  const cache = new Map<string, Sample>();
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
    const key = `${choice.model}|${choice.voice}`;
    const served = (cached: boolean, hit: Sample): WizardReply<TClipWizardVoiceSampleResponse> => ({
      status: 200,
      body: { voiceId, ...hit, cached },
    });

    /** Another request is making this sample: wait, then use its result if it made one. */
    const pending = inflight.get(key);
    if (pending) {
      await pending.catch(() => undefined);
    }
    const hit = cache.get(key);
    if (hit) {
      return served(true, hit);
    }
    if (!deps.narration) {
      return fail('unavailable');
    }
    const narration = deps.narration;
    const work = (async (): Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>> => {
      try {
        const made = await narration.generate(req, SAMPLE_TEXT[entry.lang], choice);
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
        cache.set(key, stored);
        return served(false, stored);
      } catch (error) {
        logger.error(`[clip] wizard voice sample failed voice=${voiceId}`, error);
        return fail('provider_failed');
      }
    })();
    inflight.set(key, work);
    try {
      return await work;
    } finally {
      inflight.delete(key);
    }
  };
}
