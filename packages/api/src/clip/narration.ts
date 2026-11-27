import { MEDIA_TRANSACTION_CONTEXTS } from 'librechat-data-provider';
import type { TMediaGenerationConfig } from 'librechat-data-provider';
import type { BalanceReservation } from '~/middleware/checkBalance';
import type { MediaBilling, MediaCharge } from '~/media/billing';
import type { SpeechProviderClient } from '~/speech/types';
import type { MediaAccessResult } from '~/media/config';
import type { SpeechFetch } from '~/speech/client';
import type { MediaUser } from '~/media/types';
import type { ServerRequest } from '~/types';
import { checkMediaAccess, getMediaConfig, resolveMediaEndpoint } from '~/media/config';
import { createSpeechProviderClient } from '~/speech/client';
import { getBalanceConfig } from '~/app/config';
import { mediaCredits } from '~/media/billing';
import { pcmToWav } from '~/speech/audio';

/** Why a narration line was not made (the job fails with a matching code). */
export type ClipNarrationRefusal = 'unconfigured' | 'not_allowed' | 'insufficient_credit';

export type ClipNarrationResult =
  | { ok: true; buffer: Buffer; type: string; credits: number }
  | { ok: false; code: ClipNarrationRefusal };

/** The voice a line is spoken in: a `clipTools.voices` entry of the openrouter provider. */
export interface ClipNarrationVoice {
  voice: string;
  model: string;
  /** Audio format the model returns; `media.speech.format` when unset */
  format?: 'mp3' | 'pcm';
  /** USD per 1000 characters held and assumed; `media.speech.estimateUsd` per call when unset */
  estimateUsdPerKChar?: number;
}

/** The credit held at tool time for a clip's narration, one reservation per speech call. */
export interface ClipNarrationHold {
  /** Keeps the hold for the job until its lines are made, {@link ClipNarrationService.release} runs, or `untilMs`. */
  keep: (jobId: string, untilMs: number) => void;
  /** Releases every reservation (the job was not recorded). */
  release: () => Promise<void>;
}

/** Narration through the speech tool's client and ledger, charged like clip AI images. */
export interface ClipNarrationService {
  /**
   * Checks media access and holds the estimate for every speech call the lines need, so a user
   * cannot start a clip they cannot pay for.
   */
  reserve(
    req: ServerRequest,
    texts: readonly string[],
    voice: ClipNarrationVoice,
    conversationId?: string,
  ): Promise<{ ok: true; hold: ClipNarrationHold } | { ok: false; message: string; code: ClipNarrationRefusal }>;
  /**
   * Speaks one scene's line and records its charge (provider cost, else the estimate). Access and
   * balance are checked again first; a refusal charges nothing. Throws when the provider fails.
   */
  generate(
    req: ServerRequest,
    text: string,
    voice: ClipNarrationVoice,
    options?: { conversationId?: string; jobId?: string },
  ): Promise<ClipNarrationResult>;
  /** Releases whatever is still held for the job. */
  release(jobId: string): Promise<void>;
  /**
   * Gives back narration credits already recorded (the clip failed on the provider's side).
   * Resolves `false` when the ledger write failed, so the caller keeps its own record.
   */
  refund(
    req: ServerRequest,
    credits: number,
    conversationId?: string,
    model?: string,
  ): Promise<boolean>;
}

export interface ClipNarrationServiceDeps {
  billing: MediaBilling;
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  fetch?: SpeechFetch;
  /** Replaces the OpenRouter speech client (tests) */
  speechClient?: SpeechProviderClient;
}

const REFUSALS: Record<'media_disabled' | 'paid_only' | 'not_in_pack', string> = {
  media_disabled: 'An admin turned speech generation off for this account.',
  paid_only:
    'AI narration is part of paid packs; the user can buy one from «خرید اعتبار» (/payment).',
  not_in_pack: "The user's pack does not include speech generation.",
};

type Slot = BalanceReservation | undefined;

const releaseAll = async (slots: Slot[]): Promise<void> => {
  await Promise.all(slots.splice(0).map((slot) => slot?.release()));
};

/** Splits text into pieces of at most `max` characters, at sentence ends, else spaces. */
export function chunkNarration(text: string, max: number): string[] {
  const words = text.trim();
  if (words.length <= max) {
    return words ? [words] : [];
  }
  const chunks: string[] = [];
  let rest = words;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const stop = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('؟ '),
      window.lastIndexOf('\n'),
    );
    const space = window.lastIndexOf(' ');
    const cut = stop > max / 3 ? stop + 1 : space > 0 ? space : max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

export function createClipNarrationService(deps: ClipNarrationServiceDeps): ClipNarrationService {
  const client = deps.speechClient ?? createSpeechProviderClient({ fetch: deps.fetch });
  const kept = new Map<string, { slots: Slot[]; timer: ReturnType<typeof setTimeout> }>();

  function setup(req: ServerRequest) {
    const config = getMediaConfig(req.config);
    const speech = config?.speech;
    const endpoint = config ? resolveMediaEndpoint(req.config, config) : undefined;
    if (!config || !speech || !endpoint) {
      return null;
    }
    const multiplier = endpoint.priceMultiplier ?? 1;
    /** USD assumed for one speech call of `length` characters in this voice */
    const estimateUsd = (voice: ClipNarrationVoice, length: number): number =>
      voice.estimateUsdPerKChar != null
        ? (voice.estimateUsdPerKChar * length) / 1000
        : speech.estimateUsd;
    const estimate = (voice: ClipNarrationVoice, length: number): number =>
      mediaCredits(estimateUsd(voice, length), multiplier);
    return { config, speech, endpoint, estimate, estimateUsd };
  }

  const charge = (model: string, endpoint: string, conversationId?: string): MediaCharge => ({
    model,
    endpoint,
    context: MEDIA_TRANSACTION_CONTEXTS.speech,
    conversationId,
  });

  async function access(
    req: ServerRequest,
    config: TMediaGenerationConfig,
  ): Promise<MediaAccessResult> {
    const user = req.user as unknown as MediaUser | undefined;
    if (!user?.id) {
      return { ok: false, code: 'paid_only' };
    }
    return checkMediaAccess(
      config,
      user,
      deps.findBalanceByUser,
      getBalanceConfig(req.config)?.packs,
    );
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
    async reserve(req, texts, voice, conversationId) {
      const s = setup(req);
      if (!s) {
        return { ok: false, code: 'unconfigured', message: 'AI narration is not configured on this deployment.' };
      }
      if (!req.user?.id) {
        return { ok: false, code: 'not_allowed', message: 'No user.' };
      }
      const allowed = await access(req, s.config);
      if (!allowed.ok) {
        return { ok: false, code: 'not_allowed', message: REFUSALS[allowed.code] };
      }
      const chunks = texts.flatMap((text) => chunkNarration(text, s.speech.maxChars));
      const total = chunks.reduce((sum, chunk) => sum + s.estimate(voice, chunk.length), 0);
      const slots: Slot[] = [];
      for (const chunk of chunks) {
        const held = await deps.billing.hold(
          req,
          charge(voice.model || s.speech.model, s.config.endpoint, conversationId),
          s.estimate(voice, chunk.length),
        );
        if (held === 'insufficient') {
          await releaseAll(slots);
          return {
            ok: false,
            code: 'insufficient_credit',
            message: `The user's credit does not cover the AI narration (about $${(total / 1e6).toFixed(2)}). Tell the user to top up from «خرید اعتبار» (/payment).`,
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

    async generate(req, text, voice, options = {}) {
      const s = setup(req);
      if (!s) {
        return { ok: false, code: 'unconfigured' };
      }
      if (!(await access(req, s.config)).ok) {
        return { ok: false, code: 'not_allowed' };
      }
      const target = {
        ...s.endpoint,
        route: 'public' as const,
        endpoint: s.endpoint.name,
        model: voice.model,
      };
      const pieces: Buffer[] = [];
      let credits = 0;
      const format = voice.format ?? s.speech.format;
      /** Gives back what this line's earlier pieces cost, so a half-made line is not charged. */
      const undo = async (): Promise<void> => {
        if (credits > 0) {
          await deps.billing.refund(
            req,
            charge(voice.model, s.config.endpoint, options.conversationId),
            credits,
          );
          credits = 0;
        }
      };
      for (const piece of chunkNarration(text, s.speech.maxChars)) {
        const entry = options.jobId ? kept.get(options.jobId) : undefined;
        await entry?.slots.pop()?.release();
        const billed = charge(voice.model, s.config.endpoint, options.conversationId);
        const held = await deps.billing.hold(req, billed, s.estimate(voice, piece.length));
        if (held === 'insufficient') {
          await undo();
          return { ok: false, code: 'insufficient_credit' };
        }
        try {
          const synthesized = await client.synthesize({
            target,
            input: piece,
            voice: voice.voice,
            ...(s.speech.instructions ? { instructions: s.speech.instructions } : {}),
            responseFormat: format,
            timeoutMs: s.speech.timeoutMs,
          });
          if (synthesized.audio.length === 0) {
            throw new Error('no audio');
          }
          const costUsd = synthesized.generationId
            ? await client.getGenerationCost({ target, generationId: synthesized.generationId })
            : undefined;
          const spent = mediaCredits(
            costUsd ?? s.estimateUsd(voice, piece.length),
            s.endpoint.priceMultiplier ?? 1,
          );
          await deps.billing.record(req, billed, spent);
          credits += spent;
          pieces.push(synthesized.audio);
        } catch (error) {
          await undo();
          throw error;
        } finally {
          await held?.release();
        }
      }
      if (pieces.length === 0) {
        throw new Error('no narration text');
      }
      const audio = Buffer.concat(pieces);
      const wav = format === 'pcm';
      return {
        ok: true,
        buffer: wav ? pcmToWav(audio, s.speech.pcmSampleRate) : audio,
        type: wav ? 'audio/wav' : 'audio/mpeg',
        credits,
      };
    },

    async refund(req, credits, conversationId, model) {
      const s = setup(req);
      if (!s) {
        return false;
      }
      /** The model the lines were charged under, so refund and charge rows reconcile by model. */
      return deps.billing.refund(
        req,
        charge(model ?? s.speech.model, s.config.endpoint, conversationId),
        credits,
      );
    },

    release,
  };
}
