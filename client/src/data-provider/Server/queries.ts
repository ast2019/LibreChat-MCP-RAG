import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TAdminServerStatus,
  TAdminBrowserLogParams,
  TAdminBrowserLogResponse,
} from 'librechat-data-provider';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';

/** Server RAM and CPU, open browsers and the last 24 hours; refreshed every 10 seconds. */
export const useAdminServerStatusQuery = (): QueryObserverResult<TAdminServerStatus> =>
  useQuery<TAdminServerStatus>(
    [QueryKeys.adminServerStatus],
    () => dataService.getAdminServerStatus(),
    {
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
      retry: false,
    },
  );

/** The browser log, newest first, with the admin's search and filter. */
export const useAdminBrowserLogQuery = (
  params: TAdminBrowserLogParams,
): QueryObserverResult<TAdminBrowserLogResponse> =>
  useQuery<TAdminBrowserLogResponse>(
    [QueryKeys.adminBrowserLog, params],
    () => dataService.getAdminBrowserLog(params),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false },
  );

/** Closes one open browser; the status and the log show it at once. */
export const useAdminCloseBrowserMutation = (): UseMutationResult<
  { closed: boolean },
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((sessionId: string) => dataService.closeAdminBrowserSession(sessionId), {
    onSettled: () => {
      queryClient.invalidateQueries([QueryKeys.adminServerStatus]);
      queryClient.invalidateQueries([QueryKeys.adminBrowserLog]);
    },
  });
};
