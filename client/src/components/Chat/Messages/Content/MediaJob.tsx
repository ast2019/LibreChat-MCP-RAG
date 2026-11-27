import { memo, useEffect, useState } from 'react';
import { Clapperboard, TriangleAlert } from 'lucide-react';
import { Button, Progress, Spinner } from '@librechat/client';
import type { TMediaJobView } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useCancelMediaJobMutation, useMediaJobQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const ERRORS: Record<string, TranslationKeys> = {
  blocked: 'com_media_job_error_blocked',
  timeout: 'com_media_job_error_timeout',
};

/** Clip failures by the stable code the clip job worker records. */
const CLIP_ERRORS: Record<string, TranslationKeys> = {
  timeout: 'com_clip_job_error_timeout',
  cancelled: 'com_clip_job_cancelled',
  invalid_storyboard: 'com_clip_job_error_storyboard',
  narration_too_long: 'com_clip_job_error_narration',
  image_failed: 'com_clip_job_error_image',
  narration_failed: 'com_clip_job_error_voice',
  insufficient_credit: 'com_clip_job_error_credit',
  assets_too_large: 'com_clip_job_error_assets',
  audio_missing: 'com_clip_job_error_audio',
  worker_lost: 'com_clip_job_error_lost',
  unavailable: 'com_clip_job_error_unavailable',
};

/** Worker stages the card names; others fall back to the generic «rendering» label. */
const CLIP_STAGES: Record<string, TranslationKeys> = {
  queued: 'com_clip_job_stage_queued',
  waiting: 'com_clip_job_stage_queued',
  assets: 'com_clip_job_stage_assets',
  validate: 'com_clip_job_stage_assets',
  tts: 'com_clip_job_stage_tts',
  bundle: 'com_clip_job_stage_prepare',
  select: 'com_clip_job_stage_prepare',
  render: 'com_clip_job_stage_render',
  encode: 'com_clip_job_stage_encode',
};

function useElapsedMinutes(since?: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const start = since ? new Date(since).getTime() : now;
  return Math.max(0, Math.floor((now - start) / 60_000));
}

/** A clip rendering on the motion studio worker: stage, percent and a cancel button. */
function ClipProgress({ job, minutes }: { job: TMediaJobView; minutes: number }) {
  const localize = useLocalize();
  const cancel = useCancelMediaJobMutation(job.id);
  const percent = Math.round((job.progress ?? 0) * 100);
  const stopping = job.cancelRequested === true || cancel.isLoading;
  const stage = stopping
    ? localize('com_clip_job_cancelling')
    : localize(CLIP_STAGES[job.stage ?? ''] ?? 'com_clip_job_stage_render');
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="clip-job-pending"
      className="border-border-light bg-surface-secondary my-2 flex max-w-xl flex-col gap-2 rounded-lg border px-3 py-3 text-sm"
    >
      <span className="flex items-center gap-3">
        <span className="bg-surface-tertiary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Clapperboard className="text-text-secondary size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-text-primary font-medium">{localize('com_clip_job_pending')}</span>
          <span className="text-text-secondary text-xs" data-testid="clip-job-stage">
            {localize('com_clip_job_stage_line', { 0: stage, 1: percent, 2: minutes })}
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={stopping}
          onClick={() => cancel.mutate()}
          aria-label={localize('com_clip_job_cancel')}
        >
          {localize('com_clip_job_cancel')}
        </Button>
      </span>
      <Progress value={percent} aria-label={localize('com_clip_job_progress_label')} />
      {cancel.isError ? (
        <span className="text-text-destructive text-xs">{localize('com_clip_job_cancel_failed')}</span>
      ) : null}
    </span>
  );
}

/** A video or clip being made in the background: progress while it runs, the player once it is
 *  ready. It reads the job from the server, so closing the page or a dropped stream loses nothing. */
const MediaJob = memo(function MediaJob({ jobId }: { jobId: string }) {
  const localize = useLocalize();
  const { data, isError } = useMediaJobQuery(jobId);
  const minutes = useElapsedMinutes(data?.createdAt);
  const clip = data?.kind === 'clip';

  if (data?.status === 'completed' && data.filepath) {
    return (
      <span className="my-2 flex max-w-xl flex-col gap-1">
        {/* Generated video carries no caption file; the request is in the message. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          controls
          playsInline
          preload="metadata"
          src={data.filepath}
          data-testid="media-job-video"
          className="border-border-light bg-surface-media-overlay max-h-112 w-full rounded-lg border"
        />
      </span>
    );
  }

  if (isError || data?.status === 'failed') {
    const key = clip
      ? (data?.errorCode && CLIP_ERRORS[data.errorCode]) || 'com_clip_job_error'
      : (data?.errorCode && ERRORS[data.errorCode]) || 'com_media_job_error';
    return (
      <span
        role="alert"
        className="border-border-light my-2 flex max-w-xl items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      >
        <TriangleAlert className="text-text-destructive size-4 shrink-0" aria-hidden="true" />
        <span className="text-text-secondary">{localize(key)}</span>
      </span>
    );
  }

  if (clip && data) {
    return <ClipProgress job={data} minutes={minutes} />;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="media-job-pending"
      className="border-border-light bg-surface-secondary my-2 flex max-w-xl items-center gap-3 rounded-lg border px-3 py-3 text-sm"
    >
      <span className="bg-surface-tertiary flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Clapperboard className="text-text-secondary size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-text-primary font-medium">{localize('com_media_job_pending')}</span>
        <span className="text-text-secondary text-xs">
          {localize('com_media_job_pending_hint', { 0: minutes })}
        </span>
      </span>
      <Spinner className="size-4" />
    </span>
  );
});

export default MediaJob;
