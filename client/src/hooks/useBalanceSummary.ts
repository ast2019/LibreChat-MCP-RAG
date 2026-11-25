import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BALANCE_DISPLAY_MODES, QueryKeys } from 'librechat-data-provider';
import type { BalanceDisplay, TBalanceResponse } from 'librechat-data-provider';
import type { BalanceSummary, CurrencyConfig } from '~/utils';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { summarizeBalance } from '~/utils';

export type BalanceState =
  | { status: 'loading' }
  | { status: 'error' }
  /** Balance is on in the startup config but the server sent no record for this user */
  | { status: 'empty' }
  | { status: 'success'; summary: BalanceSummary };

/** Hover opens the gauge card, which mounts a reader; within this window a reopen reuses
 *  the reading. Streams refetch explicitly after each turn, which bypasses it. */
const BALANCE_STALE_MS = 30_000;

/** Admin config overrides persist without schema validation, so an unknown mode can arrive. */
const toDisplay = (value: unknown): BalanceDisplay =>
  BALANCE_DISPLAY_MODES.find((mode) => mode === value) ?? 'credits';

export interface BalanceView {
  enabled: boolean;
  state: BalanceState;
  currency?: CurrencyConfig;
  /** The raw record, for detail rows the summary does not carry */
  balance?: TBalanceResponse;
}

/** How the deployment shows balance figures, for surfaces that only format an amount. */
export function useBalanceDisplay(): { display: BalanceDisplay; currency?: CurrencyConfig } {
  const { data: startupConfig } = useGetStartupConfig();
  return {
    display: toDisplay(startupConfig?.balance?.display),
    currency: startupConfig?.interface?.currency,
  };
}

/**
 * The user's balance as every surface presents it. A stale reading wins over a
 * failed refetch, so a transient error never blanks a figure the user already saw.
 */
export default function useBalanceSummary(): BalanceView {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { display, currency } = useBalanceDisplay();
  const config = startupConfig?.balance;
  const enabled = config?.enabled === true;
  const query = useGetUserBalance({
    enabled: isAuthenticated === true && enabled,
    staleTime: BALANCE_STALE_MS,
  });
  const { data, isError } = query;
  const startBalance = config?.startBalance;

  const state = useMemo<BalanceState>(() => {
    if (data != null && typeof data.tokenCredits === 'number') {
      return { status: 'success', summary: summarizeBalance(data, { display, startBalance }) };
    }
    if (isError) {
      return { status: 'error' };
    }
    return query.isFetched ? { status: 'empty' } : { status: 'loading' };
  }, [data, isError, query.isFetched, display, startBalance]);

  /**
   * Startup config is cached forever. After an admin time-pack grant, `/api/balance` can show
   * the plan while `modelSpecs` still list OpenRouter Claude (no `timePack: true`). Refetch
   * config (and models) so the selector switches to ClaudeTime.
   */
  useEffect(() => {
    if (state.status !== 'success') {
      return;
    }
    const timePackActive = state.summary.timePackExpiresAt != null;
    const list = startupConfig?.modelSpecs?.list;
    if (list == null) {
      return;
    }
    const hasTimePackSpec = list.some((spec) => spec?.timePack === true);
    if (timePackActive === hasTimePackSpec) {
      return;
    }
    void queryClient.invalidateQueries([QueryKeys.startupConfig]);
    void queryClient.invalidateQueries([QueryKeys.models]);
  }, [state, startupConfig?.modelSpecs?.list, queryClient]);

  return {
    enabled,
    state,
    currency,
    balance: state.status === 'success' ? data : undefined,
  };
}
