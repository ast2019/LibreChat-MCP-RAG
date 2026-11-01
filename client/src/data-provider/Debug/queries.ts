import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TDebugTrace,
  TDebugModeUpdate,
  TDebugModeResponse,
  TDebugTraceListParams,
  TDebugSystemLogResponse,
  TDebugTraceListResponse,
} from 'librechat-data-provider';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';

/** The debug switch and when it turns itself off; refreshed every 15 seconds. */
export const useAdminDebugModeQuery = (): QueryObserverResult<TDebugModeResponse> =>
  useQuery<TDebugModeResponse>([QueryKeys.adminDebugMode], () => dataService.getAdminDebugMode(), {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

/** Turns debug mode on for a few minutes, or off. */
export const useAdminDebugModeMutation = (): UseMutationResult<
  TDebugModeResponse,
  unknown,
  TDebugModeUpdate
> => {
  const queryClient = useQueryClient();
  return useMutation((update: TDebugModeUpdate) => dataService.updateAdminDebugMode(update), {
    onSuccess: (data) => queryClient.setQueryData([QueryKeys.adminDebugMode], data),
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.adminDebugMode]);
      queryClient.invalidateQueries([QueryKeys.adminDebugTraces]);
    },
  });
};

/** Traced chat requests, newest first; refreshed while debug mode is on. */
export const useAdminDebugTracesQuery = (
  params: TDebugTraceListParams,
  live: boolean,
): QueryObserverResult<TDebugTraceListResponse> =>
  useQuery<TDebugTraceListResponse>(
    [QueryKeys.adminDebugTraces, params],
    () => dataService.getAdminDebugTraces(params),
    {
      keepPreviousData: true,
      refetchInterval: live ? 5_000 : false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

/** One trace with its stages and log lines. */
export const useAdminDebugTraceQuery = (traceId: string | null): QueryObserverResult<TDebugTrace> =>
  useQuery<TDebugTrace>(
    [QueryKeys.adminDebugTrace, traceId],
    () => dataService.getAdminDebugTrace(traceId as string),
    { enabled: traceId != null, refetchOnWindowFocus: false, retry: false },
  );

/** This server's recent log lines. */
export const useAdminDebugSystemLogQuery = (
  enabled: boolean,
  live: boolean,
): QueryObserverResult<TDebugSystemLogResponse> =>
  useQuery<TDebugSystemLogResponse>(
    [QueryKeys.adminDebugSystemLog],
    () => dataService.getAdminDebugSystemLog(),
    { enabled, refetchInterval: live ? 5_000 : false, refetchOnWindowFocus: false, retry: false },
  );

export const useAdminClearDebugTracesMutation = (): UseMutationResult<
  { deleted: number },
  unknown,
  void
> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.clearAdminDebugTraces(), {
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.adminDebugTraces]);
      queryClient.removeQueries([QueryKeys.adminDebugTrace]);
    },
  });
};
