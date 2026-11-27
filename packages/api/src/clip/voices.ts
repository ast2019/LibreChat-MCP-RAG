import type { TClipToolsConfig, TClipVoice } from 'librechat-data-provider';

/** The voice the worker picks itself for a language (deploy/remotion/src/tts.mjs). */
const WORKER_DEFAULTS: Record<'fa' | 'en', string> = {
  fa: 'fa-IR-DilaraNeural',
  en: 'en-US-JennyNeural',
};

/** A raw Edge voice name, accepted without a catalogue entry as before. */
const EDGE_NAME = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;

/** A narration voice made by a billed provider in the API, one file per scene. */
export interface ClipOpenRouterVoice {
  provider: 'openrouter';
  voice: string;
  model: string;
  /** `media.speech.format` when unset */
  format?: 'mp3' | 'pcm';
  /** USD per 1000 characters, `media.speech.estimateUsd` per call when unset */
  estimateUsdPerKChar?: number;
}

export type ClipVoiceChoice = { provider: 'edge'; voice?: string } | ClipOpenRouterVoice;

export const clipVoiceIds = (config: Pick<TClipToolsConfig, 'voices'>): string[] =>
  config.voices.map((entry) => entry.id);

function choiceOf(entry: TClipVoice, explicit: boolean): ClipVoiceChoice {
  if (entry.provider === 'openrouter') {
    return {
      provider: 'openrouter',
      voice: entry.voice,
      model: entry.model ?? '',
      ...(entry.format ? { format: entry.format } : {}),
      ...(entry.estimateUsdPerKChar != null
        ? { estimateUsdPerKChar: entry.estimateUsdPerKChar }
        : {}),
    };
  }
  /** The worker's own default is not sent, so a deployment without `voices` sends what it always did. */
  return !explicit && entry.voice === WORKER_DEFAULTS[entry.lang]
    ? { provider: 'edge' }
    : { provider: 'edge', voice: entry.voice };
}

/**
 * Resolves `audio.voice` against the catalogue. An id picks its entry; no id picks the first
 * entry of the clip's language; a bare Edge voice name still works. Returns an error text
 * naming the valid ids otherwise.
 */
export function resolveClipVoice(
  config: Pick<TClipToolsConfig, 'voices'>,
  voice: string | undefined,
  lang: 'fa' | 'en',
): { ok: true; choice: ClipVoiceChoice } | { ok: false; error: string } {
  if (!voice) {
    const first = config.voices.find((entry) => entry.lang === lang);
    return { ok: true, choice: first ? choiceOf(first, false) : { provider: 'edge' } };
  }
  const entry = config.voices.find((item) => item.id === voice);
  if (entry) {
    return { ok: true, choice: choiceOf(entry, true) };
  }
  if (EDGE_NAME.test(voice)) {
    return { ok: true, choice: { provider: 'edge', voice } };
  }
  return { ok: false, error: `must be one of the voice ids: ${clipVoiceIds(config).join(', ')}` };
}

/** One line per voice for the tool context: id, label, language, provider. */
export function describeClipVoices(config: Pick<TClipToolsConfig, 'voices'>): string {
  return config.voices
    .map(
      (entry) =>
        `${entry.id} (${entry.label}, ${entry.lang}${entry.provider === 'openrouter' ? ', charged' : ''})`,
    )
    .join('; ');
}
