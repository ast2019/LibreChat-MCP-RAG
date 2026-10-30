import { memo, useEffect, useState } from 'react';
import { Clapperboard, TriangleAlert } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import { useMediaJobQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const ERRORS: Record<string, TranslationKeys> = {
  blocked: 'com_media_job_error_blocked',
  timeout: 'com_media_job_error_timeout',
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

/** A video being made in the background: progress while it runs, the player once it is ready.
 *  It reads the job from the server, so closing the page or a dropped stream loses nothing. */
const MediaJob = memo(function MediaJob({ jobId }: { jobId: string }) {
  const localize = useLocalize();
  const { data, isError } = useMediaJobQuery(jobId);
  const minutes = useElapsedMinutes(data?.createdAt);

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
    const key = (data?.errorCode && ERRORS[data.errorCode]) || 'com_media_job_error';
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
