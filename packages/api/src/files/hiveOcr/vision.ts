import type { VisionCaller, VisionRequest, VisionResponse } from './types';
import { OcrError } from './types';

export const OCR_SYSTEM_PROMPT: string = [
  'You are an OCR engine. Transcribe ALL text in the image exactly as written.',
  'Rules:',
  '- Do not translate, summarize, correct, explain or add any commentary.',
  '- Keep Persian/Arabic right-to-left text in correct logical (reading) order, using Persian letters (ی, ک) as printed and the half-space (ZWNJ) where the word has one.',
  '- Keep numbers and digits exactly as printed (Persian ۰-۹, Arabic ٠-٩ or Latin 0-9).',
  '- Render tables as Markdown tables and headings as Markdown headings; keep paragraphs and list structure.',
  '- Follow the reading order of the page (columns top to bottom, right column first for Persian pages).',
  '- If the image contains no text, output an empty string.',
  '- Output only the transcription.',
].join('\n');

export const OCR_USER_PROMPT: string = 'Transcribe all text on this page.';

export interface VisionEndpoint {
  baseURL: string;
  apiKey: string;
  /** Extra body fields of the endpoint (e.g. `provider: { zdr: true }`), sent with every call. */
  addParams?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpenAICompatibleVisionCallerOptions {
  resolveEndpoint: (name: string) => VisionEndpoint | undefined;
  timeoutMs: number;
  /** Tokens assumed for the prompt + image when the provider returns no usage. */
  fallbackPromptTokens?: number;
  /** Retries for 429/5xx and network errors (default 1). */
  retries?: number;
  retryDelayMs?: number;
  fetch?: FetchLike;
}

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** Rough upper estimate for Persian/mixed output: ~1 token per 2 characters. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function readContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part: unknown) =>
      part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .join('');
}

/** Strips wrappers models add despite instructions: code fences and a literal `""`. */
export function cleanTranscription(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fenced) {
    text = fenced[1].trim();
  }
  if (text === '""' || text === "''") {
    return '';
  }
  return text;
}

function toCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Vision OCR over an OpenAI-compatible `/chat/completions` API (OpenRouter, vLLM, Ollama…).
 * The endpoint's `addParams` are merged into every request body so a ZDR endpoint stays ZDR;
 * model, messages and `temperature: 0` always win over them.
 */
export function createOpenAICompatibleVisionCaller(
  options: OpenAICompatibleVisionCallerOptions,
): VisionCaller {
  const doFetch: FetchLike = options.fetch ?? (fetch as unknown as FetchLike);
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const fallbackPromptTokens = options.fallbackPromptTokens ?? 1500;

  return async (request: VisionRequest): Promise<VisionResponse> => {
    const endpoint = options.resolveEndpoint(request.endpoint);
    if (!endpoint) {
      throw new OcrError(
        'endpoint_not_found',
        `OCR endpoint "${request.endpoint}" is not configured`,
      );
    }

    const url = `${endpoint.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const isOpenRouter = /openrouter\.ai/i.test(endpoint.baseURL);
    const body: Record<string, unknown> = {
      ...(endpoint.addParams ?? {}),
      model: request.model,
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_USER_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:${request.mimetype};base64,${request.image.toString('base64')}`,
              },
            },
          ],
        },
      ],
    };
    if (isOpenRouter) {
      body.usage = { include: true };
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(endpoint.headers ?? {}),
    };
    if (endpoint.apiKey) {
      headers.Authorization = `Bearer ${endpoint.apiKey}`;
    }
    const serialized = JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      if (request.signal?.aborted) {
        throw new OcrError('aborted', 'OCR was cancelled');
      }
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      let status = 0;
      try {
        const response = await doFetch(url, { method: 'POST', headers, body: serialized, signal });
        status = response.status;
        if (response.ok) {
          return parseResponse((await response.json()) as ChatCompletionPayload);
        }
      } catch (error) {
        if (request.signal?.aborted) {
          throw new OcrError('aborted', 'OCR was cancelled');
        }
        if (timeout.aborted) {
          throw new OcrError('timeout', `Vision OCR timed out after ${options.timeoutMs} ms`);
        }
        if (error instanceof OcrError) {
          throw error;
        }
      }
      if (attempt >= retries || (status !== 0 && !isRetryable(status))) {
        const detail = status ? `status ${status}` : 'a network error';
        throw new OcrError('vision_failed', `Vision OCR request failed with ${detail}`);
      }
      await delay(retryDelayMs * (attempt + 1), request.signal ?? timeout);
    }
  };

  function parseResponse(payload: ChatCompletionPayload): VisionResponse {
    const text = cleanTranscription(readContent(payload.choices?.[0]?.message?.content));
    const promptTokens = toCount(payload.usage?.prompt_tokens);
    const completionTokens = toCount(payload.usage?.completion_tokens);
    if (promptTokens != null && completionTokens != null) {
      return { text, promptTokens, completionTokens, estimated: false };
    }
    return {
      text,
      promptTokens: promptTokens ?? fallbackPromptTokens,
      completionTokens: completionTokens ?? estimateTextTokens(text),
      estimated: true,
    };
  }
}
