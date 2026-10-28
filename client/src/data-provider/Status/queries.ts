import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationResult,
  QueryObserverResult,
} from '@tanstack/react-query';
import type { TServiceStatusResponse } from 'librechat-data-provider';

/** Credit and health of the external services; served from the server's cached snapshot. */
export const useAdminServiceStatusQuery = (
  config?: UseQueryOptions<TServiceStatusResponse>,
): QueryObserverResult<TServiceStatusResponse> =>
  useQuery<TServiceStatusResponse>(
    [QueryKeys.adminServiceStatus],
    () => dataService.getAdminServiceStatus(),
    { staleTime: 60_000, refetchOnWindowFocus: false, retry: false, ...config },
  );

/** Checks every service now and replaces the cached status with the result. */
export const useRefreshAdminServiceStatusMutation = (): UseMutationResult<
  TServiceStatusResponse,
  unknown,
  void
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.refreshAdminServiceStatus],
    () => dataService.refreshAdminServiceStatus(),
    {
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.adminServiceStatus], data);
      },
    },
  );
};
