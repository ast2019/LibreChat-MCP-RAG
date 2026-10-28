import type { THiveSttConfig, THiveTtsConfig, TSpeechErrorCode } from 'librechat-data-provider';

/** Where a conversation's speech may go: `public` and `private` call the configured endpoint
 *  (`private` with zero data retention), `local` never leaves the device. */
export type SpeechRoute = 'public' | 'private' | 'local';

export type HiveSttConfig = THiveSttConfig;
export type HiveTtsConfig = THiveTtsConfig;
export type SpeechErrorCode = TSpeechErrorCode;

/** Server speech failure with a stable code; messages never carry provider payloads. */
export class SpeechError extends Error {
  readonly code: SpeechErrorCode;

  constructor(code: SpeechErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SpeechError';
    this.code = code;
  }
}

export function isSpeechError(error: unknown): error is SpeechError {
  return error instanceof SpeechError;
}

/** HTTP status of a speech failure at the request boundary. */
export function speechErrorStatus(code: SpeechErrorCode): number {
  switch (code) {
    case 'empty_input':
    case 'unsupported_format':
    case 'empty_transcript':
      return 400;
    case 'insufficient_balance':
      return 402;
    case 'local_route':
      return 409;
    case 'too_large':
      return 413;
    case 'aborted':
      return 499;
    case 'provider_failed':
      return 502;
    case 'timeout':
      return 504;
    case 'disabled':
    case 'route_not_configured':
    case 'endpoint_not_found':
      return 503;
    default:
      return 500;
  }
}

/** Server-side credentials of the endpoint a speech route names. */
export interface SpeechEndpoint {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  /** `addParams.provider` of the endpoint (e.g. `{ zdr: true }`), forwarded to `/audio/*`. */
  provider?: Record<string, unknown>;
  /** The endpoint's `priceMultiplier` (1 when unset). */
  priceMultiplier: number;
}

/** A speech target resolved for one request. */
export interface SpeechTarget extends SpeechEndpoint {
  route: Exclude<SpeechRoute, 'local'>;
  endpoint: string;
  model: string;
}

export interface TranscriptionRequest {
  target: SpeechTarget;
  audio: Buffer;
  /** Short format name (`webm`, `ogg`, `m4a`, `wav`, `mp3`, `flac`, `aac`). */
  format: string;
  mimetype: string;
  language?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  /** USD the provider charged, when it reports one (OpenRouter `usage.cost`). */
  costUsd?: number;
  /** Audio length, when the provider reports it. */
  seconds?: number;
}

export interface SynthesisRequest {
  target: SpeechTarget;
  input: string;
  voice: string;
  instructions?: string;
  responseFormat: 'pcm' | 'mp3';
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SynthesisResult {
  audio: Buffer;
  /** Provider generation id (OpenRouter `X-Generation-Id`), used to read the charged cost. */
  generationId?: string;
}

/** The provider integration: an OpenAI-compatible `/audio/*` API by default. */
export interface SpeechProviderClient {
  transcribe: (request: TranscriptionRequest) => Promise<TranscriptionResult>;
  synthesize: (request: SynthesisRequest) => Promise<SynthesisResult>;
  /** USD charged for a generation, or `undefined` when the provider cannot tell (yet). */
  getGenerationCost: (params: {
    target: SpeechTarget;
    generationId: string;
    signal?: AbortSignal;
  }) => Promise<number | undefined>;
}
