import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

export const useGetBannerQuery = (
  config?: UseQueryOptions<t.TBannerResponse>,
): QueryObserverResult<t.TBannerResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBannerResponse>([QueryKeys.banner], () => dataService.getBanner(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

export const useGetUserBalance = (
  config?: UseQueryOptions<t.TBalanceResponse>,
): QueryObserverResult<t.TBalanceResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBalanceResponse>([QueryKeys.balance], () => dataService.getUserBalance(), {
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

/**
 * The live capacity of the shared Claude time plan.
 *
 * The counters move every second, so the reading is polled rather than cached: a stale figure
 * would tell the user the road is free while the gateway is already refusing traffic. The
 * interval is short enough to be useful and long enough not to hammer the server.
 */
export const useGetTimePackStatus = (
  config?: UseQueryOptions<t.TTimePackStatusResponse>,
): QueryObserverResult<t.TTimePackStatusResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TTimePackStatusResponse>(
    [QueryKeys.timePackStatus],
    () => dataService.getTimePackStatus(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      refetchInterval: 15_000,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetSearchEnabledQuery = (
  config?: UseQueryOptions<boolean>,
): QueryObserverResult<boolean> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<boolean>([QueryKeys.searchEnabled], () => dataService.getSearchEnabled(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};
