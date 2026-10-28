import { normalizeEndpointName } from 'librechat-data-provider';
import type { TModelSpec, TServerSpeechConfig, TSpeechErrorCode } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';

/** What a speech request names about its conversation (the server decides the route). */
export interface SpeechRouteFields {
  conversationId?: string;
  endpoint?: string;
  spec?: string;
}

type RouteSpec = Partial<Pick<TModelSpec, 'name' | 'privacy'>> & {
  preset?: { endpoint?: string | null } | null;
};

/** A conversation-like value: the composer's or a message's conversation. */
export interface SpeechConversation {
  conversationId?: string | null;
  endpoint?: string | null;
  spec?: string | null;
}

export function toSpeechRouteFields(conversation?: SpeechConversation | null): SpeechRouteFields {
  const fields: SpeechRouteFields = {};
  if (conversation?.conversationId && conversation.conversationId !== 'new') {
    fields.conversationId = conversation.conversationId;
  }
  if (conversation?.endpoint) {
    fields.endpoint = conversation.endpoint;
  }
  if (conversation?.spec) {
    fields.spec = conversation.spec;
  }
  return fields;
}

/** UI languages whose browsers rarely have a recognizer or voice: server speech is preferred. */
const SERVER_SPEECH_LANGUAGES: ReadonlySet<string> = new Set(['fa']);

/** Whether a UI language (`auto` reads the browser's) should start on server speech. */
export function prefersServerSpeech(uiLanguage?: string | null): boolean {
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : '';
  const tag = !uiLanguage || uiLanguage === 'auto' ? browserLanguage : uiLanguage;
  return SERVER_SPEECH_LANGUAGES.has((tag ?? '').split(/[-_]/)[0].toLowerCase());
}

/** Adds the route fields to a speech request body. */
export function appendSpeechRouteFields(formData: FormData, fields?: SpeechRouteFields): void {
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value) {
      formData.append(key, value);
    }
  }
}

/**
 * Whether a conversation runs on the deployment's own model, mirroring the server's routing:
 * its spec says `privacy: 'local'`, or it (or the spec's preset) uses a local endpoint. Its audio
 * and text never leave the device, so only browser speech is used.
 */
export function isLocalSpeechConversation(
  conversation: SpeechConversation | null | undefined,
  serverSpeech: TServerSpeechConfig | undefined,
  specs?: ReadonlyArray<RouteSpec> | null,
): boolean {
  if (!conversation) {
    return false;
  }
  const spec = conversation.spec
    ? specs?.find((entry) => entry?.name === conversation.spec)
    : undefined;
  if (spec?.privacy === 'local') {
    return true;
  }
  const local = new Set((serverSpeech?.localEndpoints ?? []).map(normalizeEndpointName));
  return [conversation.endpoint, spec?.preset?.endpoint].some(
    (name) => name != null && name !== '' && local.has(normalizeEndpointName(name)),
  );
}

const SPEECH_ERROR_KEYS: Partial<Record<TSpeechErrorCode, TranslationKeys>> = {
  insufficient_balance: 'com_ui_speech_error_balance',
  too_large: 'com_ui_speech_error_too_long',
  empty_transcript: 'com_ui_speech_error_no_speech',
  unsupported_format: 'com_ui_speech_error_format',
  timeout: 'com_ui_speech_error_timeout',
  local_route: 'com_ui_speech_error_local',
  disabled: 'com_ui_speech_error_unavailable',
  route_not_configured: 'com_ui_speech_error_unavailable',
  endpoint_not_found: 'com_ui_speech_error_unavailable',
};

/** Localization key for a server speech failure code (a generic message for anything else). */
export function speechErrorKey(code?: string): TranslationKeys {
  return SPEECH_ERROR_KEYS[code as TSpeechErrorCode] ?? 'com_ui_speech_error_generic';
}

function decodeBody(data: unknown): unknown {
  /** Tagged, not `instanceof`: the buffer may come from another realm (worker, iframe). */
  const isBuffer =
    Object.prototype.toString.call(data) === '[object ArrayBuffer]' || ArrayBuffer.isView(data);
  if (isBuffer) {
    try {
      return JSON.parse(new TextDecoder().decode(data as ArrayBuffer));
    } catch {
      return undefined;
    }
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return data;
}

/** The `{ code }` of a failed speech request (JSON or `arraybuffer` axios responses). */
export function readSpeechErrorCode(error: unknown): string | undefined {
  const response = (error as { response?: { data?: unknown } } | null)?.response;
  const body = decodeBody(response?.data) as { code?: unknown } | undefined;
  return typeof body?.code === 'string' ? body.code : undefined;
}

/** MIME type of synthesized audio: server speech may answer WAV, other providers MP3. */
export function sniffAudioType(data: ArrayBuffer): 'audio/wav' | 'audio/mpeg' {
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const isRiff = head.length === 4 && String.fromCharCode(...head) === 'RIFF';
  return isRiff ? 'audio/wav' : 'audio/mpeg';
}

/** A few silent samples; played inside a tap so iOS lets the element play later audio. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Unlocks an audio element for playback that starts after an async fetch. iOS Safari only lets
 * an element play when `play()` was first called within a user gesture, so the tap that asks for
 * speech plays silence on the element the fetched audio will use.
 */
export function primeAudioElement(element: HTMLAudioElement): void {
  if (element.dataset.primed === 'true') {
    return;
  }
  element.dataset.primed = 'true';
  try {
    element.src = SILENT_WAV;
    const played = element.play();
    if (played && typeof played.then === 'function') {
      played.then(
        () => {
          /** The real audio may already have taken over the element. */
          if (element.src === SILENT_WAV) {
            element.pause();
          }
        },
        () => undefined,
      );
    }
  } catch {
    /* Playback is retried with the real audio. */
  }
}

const GEMINI_FEMALE: ReadonlySet<string> = new Set([
  'Zephyr',
  'Kore',
  'Leda',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Despina',
  'Erinome',
  'Laomedeia',
  'Achernar',
  'Gacrux',
  'Pulcherrima',
  'Vindemiatrix',
  'Sulafat',
]);

const GEMINI_MALE: ReadonlySet<string> = new Set([
  'Puck',
  'Charon',
  'Fenrir',
  'Orus',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Algenib',
  'Rasalgethi',
  'Alnilam',
  'Schedar',
  'Achird',
  'Zubenelgenubi',
  'Sadachbia',
  'Sadaltager',
]);

/** Localization key describing a known server voice (`undefined` for unknown voices). */
export function voiceDescriptionKey(voice: string): TranslationKeys | undefined {
  if (GEMINI_FEMALE.has(voice)) {
    return 'com_nav_voice_female';
  }
  if (GEMINI_MALE.has(voice)) {
    return 'com_nav_voice_male';
  }
  return undefined;
}
