import { logger } from '@librechat/data-schemas';
import { CLIP_FILE_CONTEXT } from 'librechat-data-provider';
import type { MediaJobKind, MediaJobRecord, MediaJobUpdate } from '@librechat/data-schemas';
import type { RemotionServiceClient, WorkerJobView } from './client';
import type { ClipRequest, WorkerJobRequest } from './scene';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipImageService } from './images';
import type { MediaFetch } from '~/media/types';
import type { ClipFile } from './tools';
import type { ServerRequest } from '~/types';
import { pexelsKey, searchPexelsPhoto } from './images';
import { RemotionServiceError } from './client';
import { recordClipEvent } from './diagnostics';
import { getClipConfig } from './config';

/** How often a clip job is looked at while it renders. */
export const CLIP_POLL_MS = 3_000;
/** A busy worker is asked again after this long. */
const BUSY_RETRY_MS = 15_000;
const LEASE_MS = 5 * 60_000;

export const CLIP_JOB_KIND: MediaJobKind = 'clip';

/** Stable codes the chat card maps to localized copy. */
export type ClipJobErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'invalid_storyboard'
  | 'narration_too_long'
  | 'image_failed'
  | 'audio_missing'
  | 'worker_lost'
  | 'render_failed'
  | 'unavailable';

export interface ClipJobRunnerDeps {
  claimDueMediaJobs: (params: {
    now: Date;
    leaseMs: number;
    limit: number;
    kinds?: MediaJobKind[];
  }) => Promise<MediaJobRecord[]>;
  updateMediaJob: (jobId: string, update: MediaJobUpdate) => Promise<MediaJobRecord | null>;
  loadOwnerRequest: (job: MediaJobRecord) => Promise<ServerRequest | null>;
  saveMedia: (
    req: ServerRequest,
    file: { buffer: Buffer; type: string; filename: string; context: string },
  ) => Promise<ClipFile>;
  loadImage: (req: ServerRequest, fileId: string) => Promise<{ buffer: Buffer; type: string } | null>;
  loadAudio: (req: ServerRequest, fileId: string) => Promise<{ buffer: Buffer; type: string } | null>;
  /** The worker client; null when REMOTION_SERVICE_URL/TOKEN are missing */
  client: () => RemotionServiceClient | null;
  images?: ClipImageService;
  fetch?: MediaFetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

/** What a clip job stores in `payload`: the validated request plus render settings. */
export interface ClipJobPayload {
  request: ClipRequest;
  shortSide: number;
  maxDurationSec: number;
  renderTimeoutMs: number;
  filename: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

class ClipJobError extends Error {
  constructor(
    readonly code: ClipJobErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Worker codes the card may show; anything else is a plain render failure. */
function mapWorkerCode(code: string | undefined): ClipJobErrorCode {
  switch (code) {
    case 'timeout':
    case 'cancelled':
    case 'invalid_storyboard':
    case 'narration_too_long':
      return code;
    case 'invalid_input':
      return 'invalid_storyboard';
    default:
      return 'render_failed';
  }
}

/**
 * Drives clip jobs: resolves images (the user's files, AI images charged through the image
 * path, Pexels photos) and upload audio, submits the render, mirrors the worker's stage and
 * progress onto the job for the chat card, and saves the MP4 for its owner. Cancellation and
 * the deadline stop the worker's render through its cancel route.
 */
export function createClipJobRunner(deps: ClipJobRunnerDeps): {
  tick: () => Promise<number>;
  step: (job: MediaJobRecord) => Promise<void>;
} {
  const now = deps.now ?? (() => new Date());
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));

  async function fail(job: MediaJobRecord, code: ClipJobErrorCode, detail?: string): Promise<void> {
    await deps.updateMediaJob(job.id, { status: 'failed', errorCode: code });
    const event = code === 'cancelled' ? 'job.cancelled' : 'job.failed';
    recordClipEvent({ event, level: code === 'cancelled' ? 'info' : 'warn', jobId: job.id, code, detail });
    logger.warn(`[clip] ${event} job=${job.id} code=${code}${detail ? ` detail=${detail}` : ''}`);
  }

  async function stopWorker(client: RemotionServiceClient | null, job: MediaJobRecord): Promise<void> {
    if (!client || !job.workerJobId) {
      return;
    }
    try {
      await client.cancel(job.workerJobId);
    } catch (error) {
      logger.warn(`[clip] worker cancel failed job=${job.id}: ${(error as Error).message}`);
    }
  }

  async function buildAssets(
    req: ServerRequest,
    job: MediaJobRecord,
    payload: ClipJobPayload,
    config: TClipToolsConfig,
  ): Promise<{ assets: WorkerJobRequest['assets']; audioAsset?: string; warnings: string[] }> {
    const { request } = payload;
    const assets: WorkerJobRequest['assets'] = {};
    const warnings: string[] = [];
    const stockKey = pexelsKey(config.stockImages, deps.env);
    for (const ref of request.images) {
      if (ref.source === 'file') {
        const file = await deps.loadImage(req, ref.fileId);
        if (!file || !IMAGE_TYPES.has(file.type)) {
          throw new ClipJobError('image_failed', `image ${ref.fileId} was not found`);
        }
        assets[ref.id] = { kind: 'image', mime: file.type, base64: file.buffer.toString('base64') };
      } else if (ref.source === 'ai') {
        if (!deps.images || !config.aiImages) {
          throw new ClipJobError('image_failed', 'AI images are off');
        }
        const made = await deps.images
          .generate(req, ref.prompt, request.storyboard.aspectRatio, job.conversationId)
          .catch((error: Error) => {
            throw new ClipJobError('image_failed', `AI image failed: ${error.message.slice(0, 120)}`);
          });
        const mime = IMAGE_TYPES.has(made.type) ? made.type : 'image/png';
        assets[ref.id] = { kind: 'image', mime, base64: made.buffer.toString('base64') };
      } else {
        if (!stockKey) {
          throw new ClipJobError('image_failed', 'stock photos are off');
        }
        const photo = await searchPexelsPhoto(doFetch, stockKey, ref.query, request.storyboard.aspectRatio).catch(
          (error: Error) => {
            throw new ClipJobError('image_failed', `stock photo failed: ${error.message.slice(0, 120)}`);
          },
        );
        if (!photo) {
          throw new ClipJobError('image_failed', `no stock photo matched "${ref.query.slice(0, 40)}"`);
        }
        assets[ref.id] = {
          kind: 'image',
          mime: IMAGE_TYPES.has(photo.type) ? photo.type : 'image/jpeg',
          base64: photo.buffer.toString('base64'),
          credit: photo.credit,
        };
      }
    }
    let audioAsset: string | undefined;
    if (request.audio.mode === 'upload' && request.audio.fileId) {
      const audio = await deps.loadAudio(req, request.audio.fileId);
      if (!audio) {
        throw new ClipJobError('audio_missing', 'the uploaded audio was not found');
      }
      audioAsset = 'voice';
      assets[audioAsset] = { kind: 'audio', mime: audio.type, base64: audio.buffer.toString('base64') };
    }
    return { assets, audioAsset, warnings };
  }

  async function submit(
    job: MediaJobRecord,
    req: ServerRequest,
    client: RemotionServiceClient,
  ): Promise<void> {
    const payload = job.payload as unknown as ClipJobPayload;
    const config = getClipConfig(req.config);
    await deps.updateMediaJob(job.id, { stage: 'assets', progress: 0.01, nextPollAt: new Date(now().getTime() + LEASE_MS) });
    const { assets, audioAsset } = await buildAssets(req, job, payload, config);
    const { request } = payload;
    const body: WorkerJobRequest = {
      storyboard: request.storyboard,
      assets,
      audio: {
        mode: request.audio.mode,
        ...(request.audio.voice ? { voice: request.audio.voice } : {}),
        ...(audioAsset ? { asset: audioAsset } : {}),
      },
      shortSide: payload.shortSide,
      maxDurationSec: payload.maxDurationSec,
      timeoutMs: payload.renderTimeoutMs,
    };
    let view: WorkerJobView;
    try {
      view = await client.submit(body);
    } catch (error) {
      if (error instanceof RemotionServiceError && error.code === 'busy') {
        await deps.updateMediaJob(job.id, {
          stage: 'waiting',
          nextPollAt: new Date(now().getTime() + BUSY_RETRY_MS),
        });
        return;
      }
      if (error instanceof RemotionServiceError && error.status === 400) {
        throw new ClipJobError('invalid_storyboard', (error.errors ?? [error.message]).join('; ').slice(0, 300));
      }
      throw error;
    }
    await deps.updateMediaJob(job.id, {
      workerJobId: view.jobId,
      stage: view.stage ?? 'queued',
      progress: 0.02,
      nextPollAt: new Date(now().getTime() + CLIP_POLL_MS),
    });
    recordClipEvent({ event: 'job.submitted', jobId: job.id, workerJobId: view.jobId, position: view.position });
  }

  async function follow(
    job: MediaJobRecord,
    req: ServerRequest,
    client: RemotionServiceClient,
  ): Promise<void> {
    let view: WorkerJobView;
    try {
      view = await client.job(job.workerJobId!);
    } catch (error) {
      if (error instanceof RemotionServiceError && error.status === 404) {
        await fail(job, 'worker_lost', 'the worker restarted or expired the job');
        return;
      }
      throw error;
    }
    if (view.state === 'queued' || view.state === 'running') {
      await deps.updateMediaJob(job.id, {
        stage: view.stage,
        progress: Math.max(job.progress ?? 0, Math.min(0.99, view.progress)),
        nextPollAt: new Date(now().getTime() + CLIP_POLL_MS),
      });
      return;
    }
    if (view.state === 'cancelled') {
      await fail(job, 'cancelled');
      return;
    }
    if (view.state === 'failed') {
      await deps.updateMediaJob(job.id, { warnings: view.warnings.slice(0, 20) });
      await fail(job, mapWorkerCode(view.error), view.message?.slice(0, 200));
      return;
    }
    const buffer = await client.video(job.workerJobId!);
    const payload = job.payload as unknown as ClipJobPayload;
    const saved = await deps.saveMedia(req, {
      buffer,
      type: 'video/mp4',
      filename: payload.filename,
      context: CLIP_FILE_CONTEXT,
    });
    await deps.updateMediaJob(job.id, {
      status: 'completed',
      stage: 'done',
      progress: 1,
      file_id: saved.file_id,
      filepath: saved.filepath,
      type: saved.type,
      warnings: view.warnings.slice(0, 20),
      chargedCredits: 0,
    });
    recordClipEvent({
      event: 'job.done',
      jobId: job.id,
      bytes: buffer.length,
      durationSec: view.durationSec,
      renderMs: view.timings?.renderMs,
      warnings: view.warnings.length,
    });
    for (const warning of view.warnings) {
      recordClipEvent({ event: 'worker.warning', level: 'warn', jobId: job.id, message: warning });
    }
  }

  async function step(job: MediaJobRecord): Promise<void> {
    const client = deps.client();
    if (job.cancelRequested) {
      await stopWorker(client, job);
      await fail(job, 'cancelled');
      return;
    }
    if (now().getTime() > new Date(job.deadline).getTime()) {
      await stopWorker(client, job);
      await fail(job, 'timeout', `stage ${job.stage ?? '-'}`);
      return;
    }
    if (!client) {
      await fail(job, 'unavailable', 'the Remotion worker is not configured');
      return;
    }
    try {
      const req = await deps.loadOwnerRequest(job);
      if (!req) {
        await fail(job, 'render_failed', 'the owner is gone');
        return;
      }
      if (!job.workerJobId) {
        await submit(job, req, client);
      } else {
        await follow(job, req, client);
      }
    } catch (error) {
      if (error instanceof ClipJobError) {
        await fail(job, error.code, error.message);
        return;
      }
      /** A network blip retries on the next poll until the deadline. */
      logger.warn(`[clip] job ${job.id} step failed; retrying: ${(error as Error).message}`);
      await deps.updateMediaJob(job.id, { nextPollAt: new Date(now().getTime() + CLIP_POLL_MS * 2) });
    }
  }

  async function tick(): Promise<number> {
    const due = await deps.claimDueMediaJobs({ now: now(), leaseMs: LEASE_MS, limit: 5, kinds: [CLIP_JOB_KIND] });
    await Promise.all(due.map((job) => step(job)));
    return due.length;
  }

  return { tick, step };
}
