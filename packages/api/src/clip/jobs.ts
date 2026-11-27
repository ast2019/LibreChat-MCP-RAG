import { logger } from '@librechat/data-schemas';
import { CLIP_FILE_CONTEXT, MEDIA_TRANSACTION_CONTEXTS } from 'librechat-data-provider';
import type { MediaJobKind, MediaJobRecord, MediaJobUpdate } from '@librechat/data-schemas';
import type { ClipImageRef, ClipRequest, WorkerJobRequest } from './scene';
import type { RemotionServiceClient, WorkerJobView } from './client';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipNarrationService } from './narration';
import type { ClipImageService } from './images';
import type { MediaFetch } from '~/media/types';
import type { ClipFile } from './tools';
import type { ServerRequest } from '~/types';
import { pexelsKey, searchPexelsPhoto } from './images';
import { getSafeErrorMetadata } from '~/utils/errors';
import { RemotionServiceError } from './client';
import { recordClipEvent } from './diagnostics';
import { getClipConfig } from './config';

/** How often a clip job is looked at while it renders. */
export const CLIP_POLL_MS = 3_000;
/** A busy worker is asked again after this long. */
const BUSY_RETRY_MS = 15_000;
/** First wait after a failed submit; doubles with each further failure. */
const SUBMIT_RETRY_MS = 6_000;
const LEASE_MS = 5 * 60_000;

export const CLIP_JOB_KIND: MediaJobKind = 'clip';

/** Stable codes the chat card maps to localized copy. */
export type ClipJobErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'invalid_storyboard'
  | 'narration_too_long'
  | 'image_failed'
  | 'narration_failed'
  | 'insufficient_credit'
  | 'assets_too_large'
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
  /** Narration by a billed speech model; absent when not wired */
  narration?: ClipNarrationService;
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
  /**
   * Credits charged for the job's AI images so far. Each generated image is saved as the
   * owner's file and its ref rewritten to `{ source: 'file' }`, so a retry never makes it again.
   */
  aiCredits?: number;
  /** Narration lines already made, as the owner's audio file id by scene index (never made twice) */
  narrationFiles?: Record<string, string>;
  /** Credits charged for the narration so far */
  narrationCredits?: number;
  /**
   * Set (and saved) before a provider-failure refund is attempted. A retry that finds it set
   * never refunds again: a missed refund stays visible in `chargedCredits` and `refundOwed`,
   * where a double refund would be silent.
   */
  refundStarted?: boolean;
  /** What a failed refund still owes the user; kept on the failed job for reconciliation */
  refundOwed?: { aiCredits?: number; narrationCredits?: number };
  /** Failed submits so far (worker 5xx or network), capped by `clipTools.submitRetries` */
  submitFailures?: number;
}

/** Credits charged so far for what the job generated (AI images and narration). */
const spentCredits = (payload: ClipJobPayload): number => (payload.aiCredits ?? 0) + (payload.narrationCredits ?? 0);

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * A failure that ends the job. `reason` is a fixed identifier for diagnostics; it never holds
 * user content (queries, prompts) or provider text.
 */
class ClipJobError extends Error {
  constructor(
    readonly code: ClipJobErrorCode,
    readonly reason: string,
  ) {
    super(reason);
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
 * A rejected submit that retrying cannot fix: every 4xx except 429 (busy). Worker 5xx answers
 * and network failures (the client reports them as 503/504) are retried a few times.
 */
function terminalSubmitCode(error: RemotionServiceError): ClipJobErrorCode | null {
  const { status } = error;
  if (status < 400 || status >= 500 || status === 429) {
    return null;
  }
  if (status === 400 || status === 422) {
    return 'invalid_storyboard';
  }
  if (status === 413) {
    return 'assets_too_large';
  }
  if (status === 401 || status === 403 || status === 404) {
    return 'unavailable';
  }
  return 'render_failed';
}

const assetBytes = (assets: WorkerJobRequest['assets']): number =>
  Object.values(assets).reduce((sum, asset) => sum + Math.floor((asset.base64.length * 3) / 4), 0);

/**
 * Drives clip jobs: makes the AI images once (saved as the owner's files), resolves the other
 * images and upload audio, submits the render with the job id as its idempotency key, mirrors
 * the worker's stage and progress onto the job for the chat card, and saves the MP4 for its
 * owner. Cancellation and the deadline stop the worker's render through its cancel route.
 */
export function createClipJobRunner(deps: ClipJobRunnerDeps): {
  tick: () => Promise<number>;
  step: (job: MediaJobRecord) => Promise<void>;
} {
  const now = deps.now ?? (() => new Date());
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const later = (ms: number): Date => new Date(now().getTime() + ms);
  const payloadOf = (job: MediaJobRecord): ClipJobPayload => job.payload as unknown as ClipJobPayload;

  /**
   * Gives back what a provider failure already charged (AI images and narration), once.
   * Returns the credits still charged: 0 when refunded, else everything (the ledger stays truthful).
   */
  async function refundProviderFailure(job: MediaJobRecord, payload: ClipJobPayload): Promise<number> {
    const charged = spentCredits(payload);
    if (!(charged > 0)) {
      return 0;
    }
    try {
      const req = await deps.loadOwnerRequest(job);
      if (!req) {
        throw new Error('owner request not found');
      }
      const results = await Promise.all([
        payload.aiCredits ? deps.images?.refund(req, payload.aiCredits, job.conversationId) : true,
        payload.narrationCredits
          ? deps.narration?.refund(
              req,
              payload.narrationCredits,
              job.conversationId,
              payload.request.audio.narration?.model,
            )
          : true,
      ]);
      if (results.every((ok) => ok === true)) {
        return 0;
      }
      throw new Error('refund was not recorded');
    } catch (error) {
      logger.error(`[clip] refund failed job=${job.id} credits=${charged}`, getSafeErrorMetadata(error));
      return charged;
    }
  }

  /**
   * Ends the job: no storyboard is kept, the real AI image and narration charges are recorded.
   * A provider failure (`image_failed`, `narration_failed`) refunds them first; other failures
   * keep them, since the files already made stay the user's.
   */
  async function fail(job: MediaJobRecord, code: ClipJobErrorCode, reason?: string): Promise<void> {
    const payload = job.payload ? payloadOf(job) : undefined;
    const refundable = code === 'narration_failed' || code === 'image_failed';
    let charged: number | undefined;
    if (payload) {
      charged = spentCredits(payload);
      if (refundable && charged > 0) {
        if (payload.refundStarted) {
          logger.error(`[clip] refund not repeated job=${job.id} credits=${charged}`);
        } else {
          /** Saved first: if the final write below fails, the retry sees this and does not refund twice. */
          job.payload = { ...payload, refundStarted: true } as unknown as Record<string, unknown>;
          await deps.updateMediaJob(job.id, { payload: job.payload });
          charged = await refundProviderFailure(job, payload);
        }
      }
    }
    const owed = charged && payload && refundable ? charged : 0;
    await deps.updateMediaJob(job.id, {
      status: 'failed',
      errorCode: code,
      payload: owed
        ? {
            refundOwed: {
              ...(payload?.aiCredits ? { aiCredits: payload.aiCredits } : {}),
              ...(payload?.narrationCredits ? { narrationCredits: payload.narrationCredits } : {}),
            },
          }
        : null,
      ...(charged || (refundable && payload && spentCredits(payload) > 0) ? { chargedCredits: charged } : {}),
    });
    await deps.images?.release(job.id);
    await deps.narration?.release(job.id);
    const event = code === 'cancelled' ? 'job.cancelled' : 'job.failed';
    recordClipEvent({ event, level: code === 'cancelled' ? 'info' : 'warn', jobId: job.id, code, reason });
    logger.warn(`[clip] ${event} job=${job.id} code=${code}${reason ? ` reason=${reason}` : ''}`);
  }

  /** Stops the worker's render; one retry, then the failure is logged and recorded. */
  async function stopWorker(client: RemotionServiceClient | null, job: MediaJobRecord): Promise<void> {
    if (!client || !job.workerJobId) {
      return;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await client.cancel(job.workerJobId);
        return;
      } catch (error) {
        if (error instanceof RemotionServiceError && error.status === 404) {
          return;
        }
        lastError = error;
      }
    }
    const code = lastError instanceof RemotionServiceError ? lastError.code : 'exception';
    logger.error(`[clip] worker cancel failed job=${job.id} worker=${job.workerJobId} code=${code}`, getSafeErrorMetadata(lastError));
    recordClipEvent({ event: 'worker.cancel_failed', level: 'error', jobId: job.id, workerJobId: job.workerJobId, code });
  }

  /**
   * Generates the AI images still missing, saves each as the owner's file and records its file
   * id on the job before the next one, so no retry or restart generates or charges it again.
   */
  async function makeAiImages(
    req: ServerRequest,
    job: MediaJobRecord,
    config: TClipToolsConfig,
  ): Promise<WorkerJobRequest['assets']> {
    let payload = payloadOf(job);
    const made: WorkerJobRequest['assets'] = {};
    if (!payload.request.images.some((ref) => ref.source === 'ai')) {
      return made;
    }
    if (!deps.images || !config.aiImages) {
      throw new ClipJobError('image_failed', 'ai_images_off');
    }
    for (const ref of payload.request.images) {
      if (ref.source !== 'ai') {
        continue;
      }
      const image = await deps.images
        .generate(req, ref.prompt, payload.request.storyboard.aspectRatio, {
          conversationId: job.conversationId,
          jobId: job.id,
        })
        .catch((error: unknown) => {
          logger.warn(`[clip] AI image failed job=${job.id}`, getSafeErrorMetadata(error));
          throw new ClipJobError('image_failed', 'ai_provider');
        });
      if (!image.ok) {
        throw new ClipJobError(image.code === 'insufficient_credit' ? 'insufficient_credit' : 'image_failed', `ai_${image.code}`);
      }
      const type = IMAGE_TYPES.has(image.type) ? image.type : 'image/png';
      payload = { ...payload, aiCredits: (payload.aiCredits ?? 0) + image.credits };
      job.payload = payload as unknown as Record<string, unknown>;
      const saved = await deps
        .saveMedia(req, {
          buffer: image.buffer,
          type,
          filename: `clip-${ref.id}.${IMAGE_EXT[type] ?? 'png'}`,
          context: MEDIA_TRANSACTION_CONTEXTS.image,
        })
        .catch((error: unknown) => {
          logger.warn(`[clip] AI image save failed job=${job.id}`, getSafeErrorMetadata(error));
          throw new ClipJobError('image_failed', 'ai_save');
        });
      const images: ClipImageRef[] = payload.request.images.map((item) =>
        item.id === ref.id ? { id: ref.id, source: 'file', fileId: saved.file_id } : item,
      );
      payload = { ...payload, request: { ...payload.request, images } };
      job.payload = payload as unknown as Record<string, unknown>;
      await deps.updateMediaJob(job.id, {
        payload: job.payload,
        chargedCredits: spentCredits(payload),
        nextPollAt: later(LEASE_MS),
      });
      made[ref.id] = { kind: 'image', mime: type, base64: image.buffer.toString('base64') };
    }
    await deps.images.release(job.id);
    return made;
  }

  /**
   * Speaks each narrated scene (voices with provider `openrouter`), saves each line as the owner's
   * audio file and records its id on the job before the next, so no retry makes or charges it twice.
   */
  async function makeNarration(
    req: ServerRequest,
    job: MediaJobRecord,
  ): Promise<{ assets: WorkerJobRequest['assets']; lines: Record<string, string> }> {
    let payload = payloadOf(job);
    const voice = payload.request.audio.narration;
    const assets: WorkerJobRequest['assets'] = {};
    const lines: Record<string, string> = {};
    if (payload.request.audio.mode !== 'tts' || !voice) {
      return { assets, lines };
    }
    if (!deps.narration) {
      throw new ClipJobError('narration_failed', 'narration_off');
    }
    for (const [index, scene] of payload.request.storyboard.scenes.entries()) {
      if (typeof scene.narration !== 'string' || !scene.narration.trim()) {
        continue;
      }
      const id = `nar-${index}`;
      const savedId = payload.narrationFiles?.[index];
      if (savedId) {
        const file = await deps.loadAudio(req, savedId);
        if (!file) {
          throw new ClipJobError('audio_missing', 'narration_file_missing');
        }
        assets[id] = { kind: 'audio', mime: file.type, base64: file.buffer.toString('base64') };
        lines[index] = id;
        continue;
      }
      const made = await deps.narration
        .generate(req, scene.narration, voice, { conversationId: job.conversationId, jobId: job.id })
        .catch((error: unknown) => {
          logger.warn(`[clip] narration failed job=${job.id}`, getSafeErrorMetadata(error));
          throw new ClipJobError('narration_failed', 'narration_provider');
        });
      if (!made.ok) {
        throw new ClipJobError(
          made.code === 'insufficient_credit' ? 'insufficient_credit' : 'narration_failed',
          `narration_${made.code}`,
        );
      }
      payload = { ...payload, narrationCredits: (payload.narrationCredits ?? 0) + made.credits };
      job.payload = payload as unknown as Record<string, unknown>;
      const saved = await deps
        .saveMedia(req, {
          buffer: made.buffer,
          type: made.type,
          filename: `clip-${id}.${made.type === 'audio/wav' ? 'wav' : 'mp3'}`,
          context: MEDIA_TRANSACTION_CONTEXTS.speech,
        })
        .catch((error: unknown) => {
          logger.warn(`[clip] narration save failed job=${job.id}`, getSafeErrorMetadata(error));
          throw new ClipJobError('narration_failed', 'narration_save');
        });
      payload = { ...payload, narrationFiles: { ...payload.narrationFiles, [index]: saved.file_id } };
      job.payload = payload as unknown as Record<string, unknown>;
      await deps.updateMediaJob(job.id, {
        payload: job.payload,
        chargedCredits: spentCredits(payload),
        nextPollAt: later(LEASE_MS),
      });
      assets[id] = { kind: 'audio', mime: made.type, base64: made.buffer.toString('base64') };
      lines[index] = id;
    }
    await deps.narration.release(job.id);
    return { assets, lines };
  }

  async function buildAssets(
    req: ServerRequest,
    payload: ClipJobPayload,
    config: TClipToolsConfig,
  ): Promise<{ assets: WorkerJobRequest['assets']; audioAsset?: string }> {
    const { request } = payload;
    const assets: WorkerJobRequest['assets'] = {};
    const stockKey = pexelsKey(config.stockImages, deps.env);
    for (const ref of request.images) {
      if (ref.source === 'file') {
        const file = await deps.loadImage(req, ref.fileId);
        if (!file || !IMAGE_TYPES.has(file.type)) {
          throw new ClipJobError('image_failed', 'file_missing');
        }
        assets[ref.id] = { kind: 'image', mime: file.type, base64: file.buffer.toString('base64') };
      } else if (ref.source === 'ai') {
        /** Made after every other asset loaded, so a missing file costs no AI charge. */
        continue;
      } else {
        if (!stockKey) {
          throw new ClipJobError('image_failed', 'stock_off');
        }
        const photo = await searchPexelsPhoto(doFetch, stockKey, ref.query, request.storyboard.aspectRatio).catch(
          (error: unknown) => {
            logger.warn('[clip] stock photo failed', getSafeErrorMetadata(error));
            throw new ClipJobError('image_failed', 'stock_provider');
          },
        );
        if (!photo) {
          throw new ClipJobError('image_failed', 'stock_no_match');
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
        throw new ClipJobError('audio_missing', 'audio_missing');
      }
      audioAsset = 'voice';
      assets[audioAsset] = { kind: 'audio', mime: audio.type, base64: audio.buffer.toString('base64') };
    }
    return { assets, audioAsset };
  }

  /** A failed submit (worker 5xx, network, storage): retried with backoff up to the cap. */
  async function retrySubmit(job: MediaJobRecord, config: TClipToolsConfig, code: string): Promise<void> {
    const payload = payloadOf(job);
    const failures = (payload.submitFailures ?? 0) + 1;
    if (failures > config.submitRetries) {
      await fail(job, 'unavailable', `submit_failed_${code}`);
      return;
    }
    const next: ClipJobPayload = { ...payload, submitFailures: failures };
    job.payload = next as unknown as Record<string, unknown>;
    await deps.updateMediaJob(job.id, {
      payload: job.payload,
      stage: 'waiting',
      nextPollAt: later(SUBMIT_RETRY_MS * 2 ** (failures - 1)),
    });
    recordClipEvent({ event: 'job.retry', level: 'warn', jobId: job.id, code, failures });
  }

  async function submit(
    job: MediaJobRecord,
    req: ServerRequest,
    client: RemotionServiceClient,
    config: TClipToolsConfig,
  ): Promise<void> {
    /** Nothing is generated or uploaded for a worker that would answer busy. */
    const health = await client.health();
    if ((health.active ?? 0) >= (health.maxConcurrent ?? 1) && (health.waiting ?? 0) >= (health.maxQueue ?? Infinity)) {
      await deps.updateMediaJob(job.id, { stage: 'waiting', nextPollAt: later(BUSY_RETRY_MS) });
      return;
    }
    await deps.updateMediaJob(job.id, { stage: 'assets', progress: 0.01, nextPollAt: later(LEASE_MS) });
    const { assets: loaded, audioAsset } = await buildAssets(req, payloadOf(job), config);
    const aiImages = await makeAiImages(req, job, config);
    const spoken = await makeNarration(req, job);
    const assets = { ...loaded, ...aiImages, ...spoken.assets };
    const payload = payloadOf(job);
    if (assetBytes(assets) > config.maxAssetMb * 1024 * 1024) {
      throw new ClipJobError('assets_too_large', 'asset_bytes');
    }
    const { request } = payload;
    const body: WorkerJobRequest = {
      storyboard: request.storyboard,
      assets,
      audio:
        Object.keys(spoken.lines).length > 0
          ? { mode: 'scenes', lines: spoken.lines }
          : {
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
      view = await client.submit(body, { idempotencyKey: job.id });
    } catch (error) {
      if (!(error instanceof RemotionServiceError)) {
        throw error;
      }
      if (error.code === 'busy' || error.status === 429) {
        await deps.updateMediaJob(job.id, { stage: 'waiting', nextPollAt: later(BUSY_RETRY_MS) });
        return;
      }
      const terminal = terminalSubmitCode(error);
      if (terminal) {
        throw new ClipJobError(terminal, `submit_${error.status}`);
      }
      await retrySubmit(job, config, `${error.status}`);
      return;
    }
    await deps.updateMediaJob(job.id, {
      workerJobId: view.jobId,
      stage: view.stage ?? 'queued',
      progress: 0.02,
      nextPollAt: later(CLIP_POLL_MS),
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
        await fail(job, 'worker_lost', 'worker_404');
        return;
      }
      throw error;
    }
    if (view.state === 'queued' || view.state === 'running') {
      await deps.updateMediaJob(job.id, {
        stage: view.stage,
        progress: Math.max(job.progress ?? 0, Math.min(0.99, view.progress)),
        nextPollAt: later(CLIP_POLL_MS),
      });
      return;
    }
    if (view.state === 'cancelled') {
      await fail(job, 'cancelled');
      return;
    }
    if (view.state === 'failed') {
      await deps.updateMediaJob(job.id, { warnings: view.warnings.slice(0, 20) });
      await fail(job, mapWorkerCode(view.error), `worker_${mapWorkerCode(view.error)}`);
      return;
    }
    const buffer = await client.video(job.workerJobId!);
    const payload = payloadOf(job);
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
      chargedCredits: spentCredits(payload),
      payload: null,
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
      /** Only the warning's code (`unknown_icon`, `tts_failed`); its text may quote the storyboard. */
      recordClipEvent({ event: 'worker.warning', level: 'warn', jobId: job.id, code: warning.split(':')[0].slice(0, 40) });
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
      await fail(job, 'timeout', `stage_${job.stage ?? 'none'}`);
      return;
    }
    if (!client) {
      await fail(job, 'unavailable', 'not_configured');
      return;
    }
    let config: TClipToolsConfig | undefined;
    try {
      const req = await deps.loadOwnerRequest(job);
      if (!req) {
        await fail(job, 'render_failed', 'owner_gone');
        return;
      }
      config = getClipConfig(req.config);
      if (!job.workerJobId) {
        await submit(job, req, client, config);
      } else {
        await follow(job, req, client);
      }
    } catch (error) {
      if (error instanceof ClipJobError) {
        await fail(job, error.code, error.reason);
        return;
      }
      const code = error instanceof RemotionServiceError ? error.code : 'exception';
      logger.warn(`[clip] job ${job.id} step failed; retrying code=${code}`, getSafeErrorMetadata(error));
      if (!job.workerJobId && config) {
        await retrySubmit(job, config, code);
        return;
      }
      /** While the worker renders, a network blip retries on the next poll until the deadline. */
      await deps.updateMediaJob(job.id, { nextPollAt: later(CLIP_POLL_MS * 2) });
    }
  }

  async function tick(): Promise<number> {
    const due = await deps.claimDueMediaJobs({ now: now(), leaseMs: LEASE_MS, limit: 5, kinds: [CLIP_JOB_KIND] });
    await Promise.all(due.map((job) => step(job)));
    return due.length;
  }

  return { tick, step };
}
