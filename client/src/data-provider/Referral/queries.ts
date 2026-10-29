import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TReferralInfo, TReferralClaimResponse } from 'librechat-data-provider';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';

/** The user's invite link and what it has earned. */
export const useReferralQuery = (enabled = true): QueryObserverResult<TReferralInfo> =>
  useQuery<TReferralInfo>([QueryKeys.referral], () => dataService.getReferral(), {
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

/** Links this account to the inviter whose code it came with; refreshes the balance when paid. */
export const useClaimReferralMutation = (): UseMutationResult<
  TReferralClaimResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((code: string) => dataService.claimReferral(code), {
    onSuccess: (result) => {
      if (result.status === 'rewarded' || result.status === 'capped') {
        queryClient.invalidateQueries([QueryKeys.balance]);
        queryClient.invalidateQueries([QueryKeys.referral]);
      }
    },
  });
};
