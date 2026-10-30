import { logger } from '@librechat/data-schemas';
import type { MediaJobRecord, MediaJobUpdate } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { MediaFetch, SavedMedia } from './types';
import type { MediaBilling } from './billing';
import type { JobPoll } from './providers';
import type { ServerRequest } from '~/types';
import {
  pollHiggsfield,
  downloadMediaUrl,
  pollOpenRouterVideo,
  downloadOpenRouterVideo,
} from './providers';
import { getMediaConfig, resolveMediaEndpoint } from './config';
import { MediaError } from './types';
import { mediaCredits } from './billing';

/** What the chat shows for a job; never carries provider text. */
export interface MediaJobView {
  id: string;
  kind: 'video';
  status: MediaJobRecord['status'];
  label?: string;
  errorCode?: string;
  filepath?: string;
  type?: string;
  createdAt?: string;
}

export function toMediaJobView(job: MediaJobRecord): MediaJobView {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    ...(job.label ? { label: job.label } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.status === 'completed' && job.filepath
      ? { filepath: job.filepath, type: job.type }
      : {}),
    ...(job.createdAt ? { createdAt: new Date(job.createdAt).toISOString() } : {}),
  };
}

/** The chat link a job is shown through; the client renders it as a live card. */
export const mediaJobLink = (jobId: string): string => `/api/media/jobs/${jobId}`;

export interface MediaJobRunnerDeps {
  claimDueMediaJobs: (params: {
    now: Date;
    leaseMs: number;
    limit: number;
  }) => Promise<MediaJobRecord[]>;
  updateMediaJob: (jobId: string, update: MediaJobUpdate) => Promise<MediaJobRecord | null>;
  /** The job owner as a request: their user, tenant and resolved config. Null when gone. */
  loadOwnerRequest: (job: MediaJobRecord) => Promise<ServerRequest | null>;
  saveMedia: (
    req: ServerRequest,
    file: { buffer: Buffer; type: string; filename: string; context: string },
  ) => Promise<SavedMedia>;
  billing: Pick<MediaBilling, 'record'>;
  fetch?: MediaFetch;
  now?: () => Date;
}

const LEASE_MS = 10 * 60_000;
const BATCH = 5;

function extensionOf(type: string): string {
  const subtype = type.split('/')[1]?.split(/[;+]/)[0] ?? '';
  if (subtype === 'quicktime') {
    return 'mov';
  }
  return /^[a-z0-9]{2,5}$/.test(subtype) ? subtype : 'mp4';
}

/**
 * Polls the running media jobs and delivers each finished one: the file is saved for its owner
 * and the real cost is charged. Failures and timeouts are recorded and never charged. The chat
 * card reads the job, so a closed tab or a dropped stream loses nothing.
 */
export function createMediaJobRunner(deps: MediaJobRunnerDeps): {
  tick: () => Promise<number>;
  step: (job: MediaJobRecord) => Promise<void>;
} {
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date());

  async function poll(job: MediaJobRecord, appConfig: AppConfig | undefined): Promise<JobPoll> {
    const config = getMediaConfig(appConfig);
    if (job.provider === 'higgsfield') {
      if (!config?.higgsfield) {
        throw new MediaError('provider_error', 'Higgsfield is no longer configured');
      }
      return pollHiggsfield(doFetch, config.higgsfield, job.providerJobId, 'video');
    }
    const endpoint = config ? resolveMediaEndpoint(appConfig, config) : undefined;
    if (!endpoint) {
      throw new MediaError('provider_error', 'The media endpoint is no longer configured');
    }
    return pollOpenRouterVideo(doFetch, endpoint, job.providerJobId);
  }

  async function download(
    job: MediaJobRecord,
    appConfig: AppConfig | undefined,
    result: JobPoll & { state: 'completed' },
  ): Promise<{ buffer: Buffer; type: string }> {
    if (job.provider === 'higgsfield') {
      return downloadMediaUrl(doFetch, result.url ?? '', 'video/mp4');
    }
    const config = getMediaConfig(appConfig);
    const endpoint = config ? resolveMediaEndpoint(appConfig, config) : undefined;
    if (!endpoint) {
      throw new MediaError('provider_error', 'The media endpoint is no longer configured');
    }
    return downloadOpenRouterVideo(doFetch, endpoint, job.providerJobId);
  }

  async function step(job: MediaJobRecord): Promise<void> {
    if (now().getTime() > new Date(job.deadline).getTime()) {
      await deps.updateMediaJob(job.id, { status: 'failed', errorCode: 'timeout' });
      return;
    }
    try {
      const req = await deps.loadOwnerRequest(job);
      if (!req) {
        await deps.updateMediaJob(job.id, { status: 'failed', errorCode: 'provider_error' });
        return;
      }
      const result = await poll(job, req.config);
      if (result.state === 'pending') {
        await deps.updateMediaJob(job.id, {
          nextPollAt: new Date(now().getTime() + job.pollIntervalMs),
        });
        return;
      }
      if (result.state === 'failed') {
        await deps.updateMediaJob(job.id, { status: 'failed', errorCode: result.code });
        return;
      }
      const video = await download(job, req.config, result);
      const saved = await deps.saveMedia(req, {
        buffer: video.buffer,
        type: video.type,
        filename: `video.${extensionOf(video.type)}`,
        context: job.context,
      });
      const credits = mediaCredits(result.costUsd ?? job.fallbackUsd, job.priceMultiplier);
      await deps.billing.record(
        req,
        {
          model: job.providerModel,
          endpoint: job.endpoint,
          context: job.context,
          conversationId: job.conversationId,
        },
        credits,
      );
      await deps.updateMediaJob(job.id, {
        status: 'completed',
        file_id: saved.file_id,
        filepath: saved.filepath,
        type: saved.type,
        chargedCredits: credits,
      });
    } catch (error) {
      if (error instanceof MediaError && error.code !== 'provider_error') {
        await deps.updateMediaJob(job.id, { status: 'failed', errorCode: error.code });
        return;
      }
      /** A network blip retries on the next poll until the deadline. */
      logger.warn(`[media] job ${job.id} poll failed; retrying`);
      await deps.updateMediaJob(job.id, {
        nextPollAt: new Date(now().getTime() + job.pollIntervalMs),
      });
    }
  }

  async function tick(): Promise<number> {
    const due = await deps.claimDueMediaJobs({ now: now(), leaseMs: LEASE_MS, limit: BATCH });
    await Promise.all(due.map((job) => step(job)));
    return due.length;
  }

  return { tick, step };
}
