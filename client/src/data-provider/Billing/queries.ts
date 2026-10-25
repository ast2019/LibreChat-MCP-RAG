import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TAdminBillingSummary,
  TAdminBillingUsersParams,
  TAdminBillingGrantRequest,
  TAdminBillingGrantResponse,
  TAdminBillingPacksResponse,
  TAdminBillingUsersResponse,
} from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationResult,
  QueryObserverResult,
} from '@tanstack/react-query';

export const useAdminBillingUsersQuery = (
  params: TAdminBillingUsersParams,
  config?: UseQueryOptions<TAdminBillingUsersResponse>,
): QueryObserverResult<TAdminBillingUsersResponse> =>
  useQuery<TAdminBillingUsersResponse>(
    [QueryKeys.adminBillingUsers, params],
    () => dataService.getAdminBillingUsers(params),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false, ...config },
  );

export const useAdminBillingSummaryQuery = (
  days: number,
  config?: UseQueryOptions<TAdminBillingSummary>,
): QueryObserverResult<TAdminBillingSummary> =>
  useQuery<TAdminBillingSummary>(
    [QueryKeys.adminBillingSummary, days],
    () => dataService.getAdminBillingSummary(days),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false, ...config },
  );

export const useAdminBillingPacksQuery = (
  config?: UseQueryOptions<TAdminBillingPacksResponse>,
): QueryObserverResult<TAdminBillingPacksResponse> =>
  useQuery<TAdminBillingPacksResponse>(
    [QueryKeys.adminBillingPacks],
    () => dataService.getAdminBillingPacks(),
    { staleTime: 60_000, refetchOnWindowFocus: false, retry: false, ...config },
  );

/** Grants a pack or raw credits, then refreshes the user list and the summary. */
export const useAdminBillingGrantMutation = (): UseMutationResult<
  TAdminBillingGrantResponse,
  unknown,
  TAdminBillingGrantRequest
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TAdminBillingGrantRequest) => dataService.grantAdminBilling(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
        queryClient.invalidateQueries([QueryKeys.adminBillingSummary]);
      },
    },
  );
};
