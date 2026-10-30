import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { TMediaAvailability, TMediaJobView } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';

/** Which ways to make images and videos this user can use, and what each needs. */
export const useMediaStatusQuery = (enabled = true): QueryObserverResult<TMediaAvailability> =>
  useQuery<TMediaAvailability>([QueryKeys.mediaStatus], () => dataService.getMediaStatus(), {
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

const JOB_POLL_MS = 5_000;

/** A background generation, polled until it finishes or fails. */
export const useMediaJobQuery = (jobId: string): QueryObserverResult<TMediaJobView> =>
  useQuery<TMediaJobView>([QueryKeys.mediaJob, jobId], () => dataService.getMediaJob(jobId), {
    refetchInterval: (data) => (data == null || data.status === 'pending' ? JOB_POLL_MS : false),
    refetchOnWindowFocus: false,
    retry: 2,
  });
