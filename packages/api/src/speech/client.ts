import type {
  SpeechTarget,
  SynthesisResult,
  SynthesisRequest,
  TranscriptionResult,
  TranscriptionRequest,
  SpeechProviderClient,
} from './types';
import { SpeechError } from './types';

export type SpeechFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SpeechProviderClientOptions {
  fetch?: SpeechFetch;
}

const isOpenRouter = (baseURL: string): boolean => /openrouter\.ai/i.test(baseURL);

const trimBase = (baseURL: string): string => baseURL.replace(/\/+$/, '');

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function authHeaders(target: SpeechTarget): Record<string, string> {
  const headers: Record<string, string> = { ...(target.headers ?? {}) };
  if (target.apiKey) {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }
  return headers;
}

/** The endpoint's provider preferences, made zero-data-retention on the private route. */
function providerPreferences(target: SpeechTarget): Record<string, unknown> | undefined {
  const preferences = { ...(target.provider ?? {}) };
  if (target.route === 'private') {
    preferences.zdr = true;
    preferences.data_collection = 'deny';
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/** Runs one provider call with a timeout; maps transport failures to stable codes. */
async function call(
  doFetch: SpeechFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) {
    throw new SpeechError('aborted', 'Speech request was cancelled');
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal: combined });
  } catch (error) {
    if (signal?.aborted) {
      throw new SpeechError('aborted', 'Speech request was cancelled');
    }
    if (timeout.aborted) {
      throw new SpeechError('timeout', `Speech request timed out after ${timeoutMs} ms`);
    }
    throw new SpeechError('provider_failed', 'Speech request failed with a network error', {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new SpeechError(
      'provider_failed',
      `Speech request failed with status ${response.status}`,
    );
  }
  return response;
}

/**
 * Speech over an OpenAI-compatible `/audio/transcriptions` + `/audio/speech` API. OpenRouter gets
 * its JSON transcription body (base64 `input_audio`, provider preferences, `usage.cost` back);
 * other providers get the OpenAI multipart upload.
 */
export function createSpeechProviderClient(
  options: SpeechProviderClientOptions = {},
): SpeechProviderClient {
  const doFetch: SpeechFetch = options.fetch ?? ((url, init) => fetch(url, init));

  async function transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const { target } = request;
    const url = `${trimBase(target.baseURL)}/audio/transcriptions`;
    let init: RequestInit;
    if (isOpenRouter(target.baseURL)) {
      const body: Record<string, unknown> = {
        model: target.model,
        input_audio: { data: request.audio.toString('base64'), format: request.format },
      };
      if (request.language) {
        body.language = request.language;
      }
      const provider = providerPreferences(target);
      if (provider) {
        body.provider = provider;
      }
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
        body: JSON.stringify(body),
      };
    } else {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(request.audio)], { type: request.mimetype }),
        `audio.${request.format}`,
      );
      form.append('model', target.model);
      if (request.language) {
        form.append('language', request.language);
      }
      init = { method: 'POST', headers: authHeaders(target), body: form };
    }

    const response = await call(doFetch, url, init, request.timeoutMs, request.signal);
    let payload: { text?: unknown; usage?: { cost?: unknown; seconds?: unknown } };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      throw new SpeechError('provider_failed', 'Transcription response was not JSON', {
        cause: error,
      });
    }
    return {
      text: typeof payload?.text === 'string' ? payload.text.trim() : '',
      costUsd: finiteNumber(payload?.usage?.cost),
      seconds: finiteNumber(payload?.usage?.seconds),
    };
  }

  async function synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const { target } = request;
    const body: Record<string, unknown> = {
      model: target.model,
      input: request.input,
      voice: request.voice,
      response_format: request.responseFormat,
    };
    if (request.instructions) {
      body.instructions = request.instructions;
    }
    const provider = providerPreferences(target);
    if (provider) {
      body.provider = provider;
    }
    const response = await call(
      doFetch,
      `${trimBase(target.baseURL)}/audio/speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(target) },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
      request.signal,
    );
    const audio = Buffer.from(await response.arrayBuffer());
    const generationId = response.headers.get('x-generation-id') ?? undefined;
    return { audio, generationId: generationId || undefined };
  }

  async function getGenerationCost({
    target,
    generationId,
    signal,
  }: {
    target: SpeechTarget;
    generationId: string;
    signal?: AbortSignal;
  }): Promise<number | undefined> {
    if (!isOpenRouter(target.baseURL)) {
      return undefined;
    }
    const url = `${trimBase(target.baseURL)}/generation?id=${encodeURIComponent(generationId)}`;
    try {
      const response = await doFetch(url, { method: 'GET', headers: authHeaders(target), signal });
      if (!response.ok) {
        return undefined;
      }
      const payload = (await response.json()) as { data?: { total_cost?: unknown } };
      return finiteNumber(payload?.data?.total_cost);
    } catch {
      return undefined;
    }
  }

  return { transcribe, synthesize, getGenerationCost };
}
