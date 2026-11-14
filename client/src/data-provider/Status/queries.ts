import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationResult,
  QueryObserverResult,
} from '@tanstack/react-query';
import type {
  TServiceStatusResponse,
  TAdminHiggsfieldStatus,
  TAdminHiggsfieldUpdate,
} from 'librechat-data-provider';

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

/** Higgsfield's setup: API keys, MCP server and the shared account's owner. */
export const useAdminHiggsfieldQuery = (
  config?: UseQueryOptions<TAdminHiggsfieldStatus>,
): QueryObserverResult<TAdminHiggsfieldStatus> =>
  useQuery<TAdminHiggsfieldStatus>(
    [QueryKeys.adminHiggsfield],
    () => dataService.getAdminHiggsfield(),
    { staleTime: 30_000, refetchOnWindowFocus: false, retry: false, ...config },
  );

/** Picks (or clears with `null`) the shared Higgsfield account's owner. */
export const useUpdateAdminHiggsfieldMutation = (): UseMutationResult<
  TAdminHiggsfieldStatus,
  unknown,
  TAdminHiggsfieldUpdate
> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.updateAdminHiggsfield],
    (body: TAdminHiggsfieldUpdate) => dataService.updateAdminHiggsfield(body),
    {
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.adminHiggsfield], data);
        queryClient.invalidateQueries([QueryKeys.adminServiceStatus]);
      },
    },
  );
};
