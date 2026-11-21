import { TIME_METER_CONTEXT } from 'librechat-data-provider';
import type { TCustomConfig, TTransactionsConfig } from 'librechat-data-provider';

export type TimePackSeatRequest = {
  _timePackSeatHeld?: boolean;
};

/**
 * Whether this request should reserve/spend token credits for its primary generation.
 * Time-pack Claude seats skip credit reservation; cross-endpoint / non-Claude usage is billed.
 */
export function shouldReserveBalanceForRequest(
  req?: TimePackSeatRequest | null,
): boolean {
  return req?._timePackSeatHeld !== true;
}

export type TimePackUsageBillingInput = {
  timePackSeatHeld?: boolean;
  /** True when this usage ran on a different endpoint than the time-pack Claude agent. */
  crossEndpoint?: boolean;
  balance?: Partial<TCustomConfig['balance']> | null;
  transactions?: Partial<TTransactionsConfig> | null;
  context: string;
};

export type TimePackUsageBilling = {
  balance: Partial<TCustomConfig['balance']> | null | undefined;
  transactions: Partial<TTransactionsConfig> | null | undefined;
  context: string;
  /** Add these tokens to the Redis fairness meter (no credit debit). */
  shouldMeter: boolean;
};

/**
 * Primary ClaudeTime usage on an active seat: ledger `time_meter`, no credit debit, meter for oversale.
 * Cross-endpoint / secondary graph usage keeps the normal credit path even when a seat is held.
 */
export function resolveTimePackUsageBilling({
  timePackSeatHeld,
  crossEndpoint,
  balance,
  transactions,
  context,
}: TimePackUsageBillingInput): TimePackUsageBilling {
  if (timePackSeatHeld === true && crossEndpoint !== true) {
    return {
      balance: { enabled: false },
      transactions: { enabled: true },
      context: TIME_METER_CONTEXT,
      shouldMeter: true,
    };
  }
  return {
    balance,
    transactions,
    context,
    shouldMeter: false,
  };
}
