import type { THiggsfieldModel } from 'librechat-data-provider';
import type { MediaEndpoint, MediaFetch } from './types';
import { MediaError } from './types';

const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

const trimBase = (baseURL: string): string => baseURL.replace(/\/+$/, '');

function finiteCost(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(
  doFetch: MediaFetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      const reason = signal.reason as { name?: string } | undefined;
      throw reason?.name === 'TimeoutError'
        ? new MediaError('timeout', 'The generation took too long')
        : new MediaError('aborted', 'The generation was cancelled');
    }
    throw new MediaError('provider_error', 'The media service could not be reached');
  }
  if (!response.ok) {
    /** Moderation answers are told apart so the model can explain them; other provider text is
     *  never forwarded. */
    const blocked = response.status === 400 || response.status === 422;
    const body = blocked ? await response.text().catch(() => '') : '';
    if (blocked && /moderat|safety|nsfw|policy|flagged/i.test(body)) {
      throw new MediaError('blocked', 'The request was blocked by content moderation');
    }
    throw new MediaError('provider_error', `The media service answered ${response.status}`);
  }
  return response;
}

async function readBytes(response: Response): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_MEDIA_BYTES) {
    throw new MediaError('too_large', 'The generated file is too large');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new MediaError('too_large', 'The generated file is too large');
  }
  return buffer;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

function openRouterHeaders(target: MediaEndpoint): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(target.headers ?? {}),
    Authorization: `Bearer ${target.apiKey}`,
  };
}

export interface GeneratedImage {
  buffer: Buffer;
  type: string;
  /** Provider cost in US dollars, when reported */
  costUsd?: number;
}

/** `POST /images` on OpenRouter: one image, returned as bytes. */
export async function generateOpenRouterImage(
  doFetch: MediaFetch,
  target: MediaEndpoint,
  params: {
    model: string;
    prompt: string;
    aspectRatio?: string;
    resolution?: string;
    references?: string[];
    user?: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<GeneratedImage> {
  const signal = combineSignals(params.signal, params.timeoutMs);
  const body: Record<string, unknown> = { model: params.model, prompt: params.prompt, n: 1 };
  if (params.aspectRatio) {
    body.aspect_ratio = params.aspectRatio;
  }
  if (params.resolution) {
    body.resolution = params.resolution;
  }
  if (params.references?.length) {
    body.input_references = params.references;
  }
  if (params.user) {
    body.user = params.user;
  }
  const response = await request(
    doFetch,
    `${trimBase(target.baseURL)}/images`,
    { method: 'POST', headers: openRouterHeaders(target), body: JSON.stringify(body) },
    signal,
  );
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>;
    usage?: { cost?: unknown };
  };
  const image = payload.data?.find((item) => typeof item.b64_json === 'string' && item.b64_json);
  if (!image?.b64_json) {
    throw new MediaError('no_output', 'No image came back');
  }
  return {
    buffer: Buffer.from(image.b64_json, 'base64'),
    type: image.media_type || 'image/png',
    costUsd: finiteCost(payload.usage?.cost),
  };
}

export interface GeneratedVideo {
  buffer: Buffer;
  type: string;
  costUsd?: number;
}

/** `POST /videos` on OpenRouter, then polling until the job ends, then the content download. */
export async function generateOpenRouterVideo(
  doFetch: MediaFetch,
  target: MediaEndpoint,
  params: {
    model: string;
    prompt: string;
    duration: number;
    resolution?: string;
    aspectRatio?: string;
    generateAudio: boolean;
    firstFrame?: string;
    pollIntervalMs: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<GeneratedVideo> {
  const signal = combineSignals(params.signal, params.timeoutMs);
  const base = trimBase(target.baseURL);
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    duration: params.duration,
    generate_audio: params.generateAudio,
  };
  if (params.resolution) {
    body.resolution = params.resolution;
  }
  if (params.aspectRatio) {
    body.aspect_ratio = params.aspectRatio;
  }
  if (params.firstFrame) {
    body.frame_images = [{ frame_type: 'first_frame', image_url: params.firstFrame }];
  }
  const submitted = await request(
    doFetch,
    `${base}/videos`,
    { method: 'POST', headers: openRouterHeaders(target), body: JSON.stringify(body) },
    signal,
  );
  const job = (await submitted.json()) as { id?: string };
  if (!job.id) {
    throw new MediaError('provider_error', 'The video job was not accepted');
  }
  const jobURL = `${base}/videos/${encodeURIComponent(job.id)}`;
  for (;;) {
    await sleep(params.pollIntervalMs, signal).catch(() => {
      throw new MediaError(
        signal.aborted && params.signal?.aborted ? 'aborted' : 'timeout',
        'Stopped waiting for the video',
      );
    });
    const polled = await request(
      doFetch,
      jobURL,
      { method: 'GET', headers: openRouterHeaders(target) },
      signal,
    );
    const status = (await polled.json()) as { status?: string; usage?: { cost?: unknown } };
    if (status.status === 'completed') {
      const content = await request(
        doFetch,
        `${jobURL}/content?index=0`,
        { method: 'GET', headers: openRouterHeaders(target) },
        signal,
      );
      return {
        buffer: await readBytes(content),
        type: content.headers.get('content-type')?.split(';')[0] || 'video/mp4',
        costUsd: finiteCost(status.usage?.cost),
      };
    }
    if (
      status.status === 'failed' ||
      status.status === 'cancelled' ||
      status.status === 'expired'
    ) {
      throw new MediaError('provider_error', `The video job ended as ${status.status}`);
    }
  }
}

export interface HiggsfieldTarget {
  baseURL: string;
  apiKeyId: string;
  apiKeySecret: string;
}

export interface HiggsfieldOutput {
  buffer: Buffer;
  type: string;
}

/**
 * Submits one Higgsfield generation and waits for it. Failed, moderated and cancelled requests
 * are not charged by Higgsfield, and neither are they here.
 */
export async function generateHiggsfield(
  doFetch: MediaFetch,
  target: HiggsfieldTarget,
  params: {
    model: THiggsfieldModel;
    input: Record<string, unknown>;
    idempotencyKey: string;
    pollIntervalMs: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<HiggsfieldOutput> {
  const signal = combineSignals(params.signal, params.timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Key ${target.apiKeyId}:${target.apiKeySecret}`,
  };
  const base = trimBase(target.baseURL);
  const modelPath = params.model.id
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const submitted = await request(
    doFetch,
    `${base}/${modelPath}`,
    {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': params.idempotencyKey },
      body: JSON.stringify(params.input),
    },
    signal,
  );
  const job = (await submitted.json()) as { request_id?: string };
  if (!job.request_id) {
    throw new MediaError('provider_error', 'The Higgsfield request was not accepted');
  }
  const statusURL = `${base}/requests/${encodeURIComponent(job.request_id)}/status`;
  for (;;) {
    await sleep(params.pollIntervalMs, signal).catch(() => {
      throw new MediaError(
        signal.aborted && params.signal?.aborted ? 'aborted' : 'timeout',
        'Stopped waiting for Higgsfield',
      );
    });
    const polled = await request(doFetch, statusURL, { method: 'GET', headers }, signal);
    const status = (await polled.json()) as {
      status?: string;
      images?: Array<{ url?: string }>;
      video?: { url?: string };
    };
    if (status.status === 'nsfw') {
      throw new MediaError('blocked', 'Higgsfield blocked the request');
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new MediaError('provider_error', `The Higgsfield request ended as ${status.status}`);
    }
    if (status.status !== 'completed') {
      continue;
    }
    const url = params.model.kind === 'video' ? status.video?.url : status.images?.[0]?.url;
    if (!url || !/^https:\/\//i.test(url)) {
      throw new MediaError('no_output', 'Higgsfield returned no file');
    }
    const download = await request(doFetch, url, { method: 'GET' }, signal);
    return {
      buffer: await readBytes(download),
      type:
        download.headers.get('content-type')?.split(';')[0] ||
        (params.model.kind === 'video' ? 'video/mp4' : 'image/png'),
    };
  }
}
