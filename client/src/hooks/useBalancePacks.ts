import type { TUserBalancePacksResponse } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import { useBalancePacksQuery, useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

export interface BalancePacksView {
  query: QueryObserverResult<TUserBalancePacksResponse>;
  /** True once the server reports metering on and at least one pack to buy */
  available: boolean;
}

/** The user's buyable packs; only fetched when the deployment meters credits. */
export default function useBalancePacks(): BalancePacksView {
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = isAuthenticated === true && startupConfig?.balance?.enabled === true;
  const query = useBalancePacksQuery({ enabled });
  const available = enabled && query.data?.enabled === true && query.data.packs.length > 0;
  return { query, available };
}
