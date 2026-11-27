import { logger } from '@librechat/data-schemas';
import { CLIP_FILE_CONTEXT } from 'librechat-data-provider';
import type { MediaJobCreateData, MediaJobKind, MediaJobRecord } from '@librechat/data-schemas';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipNarrationHold, ClipNarrationService } from './narration';
import type { ClipImageHold, ClipImageService } from './images';
import type { ClipJobPayload } from './jobs';
import type { ServerRequest } from '~/types';
import type { ClipRequest } from './scene';
import { CLIP_JOB_KIND, CLIP_POLL_MS } from './jobs';
import { recordClipEvent } from './diagnostics';
import { debugTrace } from '~/debug/recorder';
import { pexelsKey } from './images';

const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;
/** Audio the worker can decode (its AUDIO_EXT table in deploy/remotion/src/server.mjs). */
export const CLIP_AUDIO_TYPES: ReadonlySet<string> = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
]);
/**
 * Sizes assumed for images the job makes or downloads later, for the size check:
 * a generated image at the configured resolution, and a Pexels `large2x` photo.
 */
const AI_IMAGE_BYTES = 3 * 1024 * 1024;
const STOCK_IMAGE_BYTES = 2 * 1024 * 1024;
/** Spoken characters per second and WAV bytes per second (24 kHz 16-bit mono), for the same check. */
const NARRATION_CHARS_PER_SEC = 12;
const NARRATION_BYTES_PER_SEC = 48_000;

/** What starting a clip job needs from the host; shared by the chat tool and the wizard. */
export interface ClipStartDeps {
  /** Records the clip as a background job; the clip job worker renders and delivers it. */
  createMediaJob: (data: MediaJobCreateData) => Promise<MediaJobRecord>;
  /** The user's pending jobs of a kind (one clip at a time per user by default). */
  countPendingMediaJobs: (userId: string, kind: MediaJobKind) => Promise<number>;
  /** One of the user's own images as bytes; null when missing or not theirs. */
  loadImage: (
    req: ServerRequest,
    fileId: string,
  ) => Promise<{ buffer: Buffer; type: string } | null>;
  /** One of the user's own audio files as bytes; null when missing or not audio. */
  loadAudio: (
    req: ServerRequest,
    fileId: string,
  ) => Promise<{ buffer: Buffer; type: string } | null>;
  /** AI images through the image tool's path and billing; absent when not wired */
  images?: ClipImageService;
  /** Narration by a billed speech model (voices with provider `openrouter`); absent when not wired */
  narration?: ClipNarrationService;
}

/** Why a clip job was not started. Nothing is charged or held after any of these. */
export type ClipStartRefusal =
  | 'busy_parallel'
  | 'busy_per_user'
  | 'file_missing'
  | 'ai_images_unavailable'
  | 'ai_images_refused'
  | 'narration_unavailable'
  | 'narration_refused'
  | 'stock_off';

export type ClipStartResult =
  | { ok: true; job: MediaJobRecord; payload: ClipJobPayload }
  | {
      ok: false;
      code: ClipStartRefusal;
      /** Text for the model (tool) or the log; not shown to users as is */
      message: string;
      pending?: number;
      /** The user's credit does not cover the hold (only with the `*_refused` codes) */
      insufficient?: boolean;
    };

/**
 * Users being given a clip job right now in this process. Two parallel calls for one user race
 * past the database count; this set closes that window.
 */
const creating = new Set<string>();

export function clipFilename(title: string, version: number): string {
  const safe = title
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const base = safe || 'clip';
  return version > 1 ? `${base}-v${version}.mp4` : `${base}.mp4`;
}

/** Files exist, audio is a format the worker reads, and the assets fit the worker's limit. */
export async function checkClipFiles(
  req: ServerRequest,
  deps: Pick<ClipStartDeps, 'loadImage' | 'loadAudio'>,
  request: ClipRequest,
  config: TClipToolsConfig,
): Promise<string | null> {
  let bytes = 0;
  for (const ref of request.images) {
    if (ref.source === 'ai') {
      bytes += AI_IMAGE_BYTES;
      continue;
    }
    if (ref.source === 'stock') {
      bytes += STOCK_IMAGE_BYTES;
      continue;
    }
    const file = await deps.loadImage(req, ref.fileId);
    if (!file) {
      return `the image ${ref.fileId} was not found among the user's files. Use an id from the attached or generated images listed in the context.`;
    }
    bytes += file.buffer.length;
  }
  if (request.audio.mode === 'upload' && request.audio.fileId) {
    const audio = FILE_ID.test(request.audio.fileId)
      ? await deps.loadAudio(req, request.audio.fileId)
      : null;
    if (!audio) {
      return 'the uploaded audio was not found. Ask the user to attach an audio file to this message and use its id.';
    }
    if (!CLIP_AUDIO_TYPES.has(audio.type)) {
      return `the uploaded audio is ${audio.type.slice(0, 40)}, which the clip builder cannot read. Ask the user for MP3, WAV, M4A, OGG or WebM audio, or use audio mode "tts" or "none".`;
    }
    bytes += audio.buffer.length;
  }
  if (request.audio.narration) {
    const chars = request.storyboard.scenes.reduce(
      (sum, scene) => sum + String(scene.narration ?? '').length,
      0,
    );
    bytes += Math.ceil((chars / NARRATION_CHARS_PER_SEC) * NARRATION_BYTES_PER_SEC);
  }
  const limit = config.maxAssetMb * 1024 * 1024;
  if (bytes > limit) {
    const mb = (n: number) => Math.ceil(n / 1024 / 1024);
    return `the images and audio come to about ${mb(bytes)} MB, over the ${config.maxAssetMb} MB a clip may carry. Use fewer or smaller images (or a shorter audio file) and call again.`;
  }
  return null;
}

/**
 * Reserves credit first (AI images, narration), then records the clip job. A refusal at any
 * point releases every hold, so nothing stays charged or held. The job keeps its holds until
 * the worker has made the images and narration.
 */
export async function startClipJob(
  req: ServerRequest,
  config: TClipToolsConfig,
  request: ClipRequest,
  deps: ClipStartDeps,
  env: Record<string, string | undefined>,
  conversationId?: string,
): Promise<ClipStartResult> {
  const userId = req.user!.id;
  if (creating.has(userId)) {
    recordClipEvent({ event: 'tool.busy', level: 'warn', reason: 'parallel_call' });
    return {
      ok: false,
      code: 'busy_parallel',
      message: 'Another clip for this user is being started right now.',
    };
  }
  creating.add(userId);
  let hold: ClipImageHold | undefined;
  let voiceHold: ClipNarrationHold | undefined;
  try {
    const pending = await deps.countPendingMediaJobs(userId, CLIP_JOB_KIND);
    if (pending >= config.maxJobsPerUser) {
      recordClipEvent({ event: 'tool.busy', level: 'warn', reason: 'per_user', pending });
      return {
        ok: false,
        code: 'busy_per_user',
        pending,
        message: `This user already has ${pending} clip being built; a new one can start when it finishes.`,
      };
    }
    const missing = await checkClipFiles(req, deps, request, config);
    if (missing) {
      recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'file_missing' });
      return { ok: false, code: 'file_missing', message: missing };
    }
    const aiCount = request.images.filter((img) => img.source === 'ai').length;
    if (aiCount > 0) {
      if (!deps.images) {
        return {
          ok: false,
          code: 'ai_images_unavailable',
          message: 'AI images are not available here.',
        };
      }
      const held = await deps.images.reserve(req, aiCount, conversationId);
      if (!held.ok) {
        recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'ai_images_refused' });
        return {
          ok: false,
          code: 'ai_images_refused',
          insufficient: held.code === 'insufficient_credit',
          message: held.message,
        };
      }
      hold = held.hold;
    }
    if (request.audio.narration) {
      if (!deps.narration) {
        return {
          ok: false,
          code: 'narration_unavailable',
          message: 'AI narration is not available here.',
        };
      }
      const lines = request.storyboard.scenes.flatMap((scene) =>
        typeof scene.narration === 'string' ? [scene.narration] : [],
      );
      const held = await deps.narration.reserve(req, lines, request.audio.narration, conversationId);
      if (!held.ok) {
        recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'narration_refused' });
        return {
          ok: false,
          code: 'narration_refused',
          insufficient: held.code === 'insufficient_credit',
          message: held.message,
        };
      }
      voiceHold = held.hold;
    }
    if (
      request.images.some((img) => img.source === 'stock') &&
      !pexelsKey(config.stockImages, env)
    ) {
      return { ok: false, code: 'stock_off', message: 'Stock photos are off on this deployment.' };
    }
    const payload: ClipJobPayload = {
      request,
      shortSide: config.height,
      maxDurationSec: config.maxDurationSec,
      renderTimeoutMs: config.renderTimeoutSec * 1000,
      filename: clipFilename(request.storyboard.title, request.version),
    };
    const created = Date.now();
    const job = await deps.createMediaJob({
      user: userId,
      kind: CLIP_JOB_KIND,
      provider: 'remotion',
      providerJobId: 'pending',
      providerModel: 'remotion',
      label: `${Math.round(request.durationSec)}s`,
      endpoint: 'remotion',
      context: CLIP_FILE_CONTEXT,
      ...(conversationId ? { conversationId } : {}),
      fallbackUsd: 0,
      priceMultiplier: 1,
      pollIntervalMs: CLIP_POLL_MS,
      nextPollAt: new Date(created),
      deadline: new Date(created + (config.queueTimeoutSec + config.renderTimeoutSec + 120) * 1000),
      progress: 0,
      stage: 'queued',
      payload: payload as unknown as Record<string, unknown>,
      ...(req.user?.tenantId ? { tenantId: String(req.user.tenantId) } : {}),
    });
    /** The job keeps the holds until its images and lines are made (or it ends). */
    hold?.keep(job.id, new Date(job.deadline).getTime());
    hold = undefined;
    voiceHold?.keep(job.id, new Date(job.deadline).getTime());
    voiceHold = undefined;
    logger.info(
      `[clip] job.created job=${job.id} scenes=${request.storyboard.scenes.length} durationSec=${request.durationSec} audio=${request.audio.narration ? 'narration' : request.audio.mode} images=${request.images.length}`,
    );
    recordClipEvent({
      event: 'job.created',
      jobId: job.id,
      theme: request.storyboard.theme,
      aspect: request.storyboard.aspectRatio,
      scenes: request.storyboard.scenes.length,
      durationSec: request.durationSec,
      audio: request.audio.mode,
      images: request.images.length,
      version: request.version,
    });
    debugTrace('clip.job', {
      phase: 'created',
      scenes: request.storyboard.scenes.length,
      durationSec: request.durationSec,
    });
    return { ok: true, job, payload };
  } finally {
    creating.delete(userId);
    await hold?.release();
    await voiceHold?.release();
  }
}
