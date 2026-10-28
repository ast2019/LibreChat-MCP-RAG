import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TPaymentOrder,
  TPaymentOptions,
  TAdminPaymentsParams,
  TAdminPaymentsSummary,
  TAdminPaymentsResponse,
  TPaymentCheckoutRequest,
  TPaymentCheckoutResponse,
  TAdminPaymentVerifyResponse,
  TAdminPaymentsReconcileResponse,
} from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationResult,
  QueryObserverResult,
} from '@tanstack/react-query';

export const usePaymentOptionsQuery = (
  config?: UseQueryOptions<TPaymentOptions>,
): QueryObserverResult<TPaymentOptions> =>
  useQuery<TPaymentOptions>([QueryKeys.paymentOptions], () => dataService.getPaymentOptions(), {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    ...config,
  });

/** The order on the result page; refetches while it is still being decided. */
export const usePaymentOrderQuery = (
  orderId: string | null | undefined,
  config?: UseQueryOptions<TPaymentOrder>,
): QueryObserverResult<TPaymentOrder> =>
  useQuery<TPaymentOrder>(
    [QueryKeys.paymentOrder, orderId],
    () => dataService.getPaymentOrder(orderId as string),
    {
      enabled: orderId != null && orderId !== '',
      refetchOnWindowFocus: false,
      retry: false,
      refetchInterval: (data) =>
        data?.status === 'pending' || (data?.status === 'paid' && !data.credited) ? 5000 : false,
      ...config,
    },
  );

/** Starts a checkout; the caller sends the browser to `redirectUrl`. */
export const usePaymentCheckoutMutation = (): UseMutationResult<
  TPaymentCheckoutResponse,
  unknown,
  TPaymentCheckoutRequest
> =>
  useMutation([MutationKeys.paymentCheckout], (payload: TPaymentCheckoutRequest) =>
    dataService.createPaymentCheckout(payload),
  );

export const useAdminPaymentsQuery = (
  params: TAdminPaymentsParams,
  config?: UseQueryOptions<TAdminPaymentsResponse>,
): QueryObserverResult<TAdminPaymentsResponse> =>
  useQuery<TAdminPaymentsResponse>(
    [QueryKeys.adminPayments, params],
    () => dataService.getAdminPayments(params),
    { keepPreviousData: true, refetchOnWindowFocus: false, retry: false, ...config },
  );

export const useAdminPaymentsSummaryQuery = (
  config?: UseQueryOptions<TAdminPaymentsSummary>,
): QueryObserverResult<TAdminPaymentsSummary> =>
  useQuery<TAdminPaymentsSummary>(
    [QueryKeys.adminPaymentsSummary],
    () => dataService.getAdminPaymentsSummary(),
    { refetchOnWindowFocus: false, retry: false, ...config },
  );

function useInvalidatePayments() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries([QueryKeys.adminPayments]);
    queryClient.invalidateQueries([QueryKeys.adminPaymentsSummary]);
    queryClient.invalidateQueries([QueryKeys.adminBillingSummary]);
    queryClient.invalidateQueries([QueryKeys.adminBillingUsers]);
  };
}

/** Re-checks one order with its gateway ("check again"). */
export const useAdminPaymentVerifyMutation = (): UseMutationResult<
  TAdminPaymentVerifyResponse,
  unknown,
  string
> => {
  const invalidate = useInvalidatePayments();
  return useMutation((orderId: string) => dataService.verifyAdminPayment(orderId), {
    onSuccess: invalidate,
  });
};

/** Re-checks every stale pending order and retries uncredited paid ones. */
export const useAdminPaymentsReconcileMutation = (): UseMutationResult<
  TAdminPaymentsReconcileResponse,
  unknown,
  void
> => {
  const invalidate = useInvalidatePayments();
  return useMutation(() => dataService.reconcileAdminPayments(), { onSuccess: invalidate });
};
