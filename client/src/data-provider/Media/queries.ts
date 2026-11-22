import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TMediaAvailability, TMediaJobView } from 'librechat-data-provider';
import type { QueryObserverResult, UseMutationResult } from '@tanstack/react-query';

/** Which ways to make images and videos this user can use, and what each needs. */
export const useMediaStatusQuery = (enabled = true): QueryObserverResult<TMediaAvailability> =>
  useQuery<TMediaAvailability>([QueryKeys.mediaStatus], () => dataService.getMediaStatus(), {
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

const JOB_POLL_MS = 5_000;
/** Clips report progress, so their card refreshes faster. */
const CLIP_POLL_MS = 3_000;

/** A background generation, polled until it finishes or fails. */
export const useMediaJobQuery = (jobId: string): QueryObserverResult<TMediaJobView> =>
  useQuery<TMediaJobView>([QueryKeys.mediaJob, jobId], () => dataService.getMediaJob(jobId), {
    refetchInterval: (data) =>
      data == null || data.status === 'pending'
        ? data?.kind === 'clip'
          ? CLIP_POLL_MS
          : JOB_POLL_MS
        : false,
    refetchOnWindowFocus: false,
    retry: 2,
  });

/** Stops a background clip; the card's job query is refreshed with the answer. */
export const useCancelMediaJobMutation = (
  jobId: string,
): UseMutationResult<TMediaJobView, unknown, void> => {
  const queryClient = useQueryClient();
  return useMutation([MutationKeys.cancelMediaJob, jobId], () => dataService.cancelMediaJob(jobId), {
    onSuccess: (job) => {
      queryClient.setQueryData([QueryKeys.mediaJob, jobId], job);
      queryClient.invalidateQueries([QueryKeys.mediaJob, jobId]);
    },
  });
};
