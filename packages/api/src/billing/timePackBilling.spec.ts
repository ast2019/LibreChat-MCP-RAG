import { TIME_METER_CONTEXT } from 'librechat-data-provider';
import {
  resolveTimePackUsageBilling,
  shouldReserveBalanceForRequest,
} from './timePackBilling';

describe('timePackBilling', () => {
  it('skips credit reservation only while a time-pack seat is held', () => {
    expect(shouldReserveBalanceForRequest(undefined)).toBe(true);
    expect(shouldReserveBalanceForRequest({})).toBe(true);
    expect(shouldReserveBalanceForRequest({ _timePackSeatHeld: false })).toBe(true);
    expect(shouldReserveBalanceForRequest({ _timePackSeatHeld: true })).toBe(false);
  });

  it('meters primary ClaudeTime usage without charging credits', () => {
    const result = resolveTimePackUsageBilling({
      timePackSeatHeld: true,
      crossEndpoint: false,
      balance: { enabled: true },
      transactions: { enabled: true },
      context: 'message',
    });
    expect(result).toEqual({
      balance: { enabled: false },
      transactions: { enabled: true },
      context: TIME_METER_CONTEXT,
      shouldMeter: true,
    });
  });

  it('keeps cross-endpoint usage on the credit path while a seat is held', () => {
    const balance = { enabled: true };
    const transactions = { enabled: true };
    const result = resolveTimePackUsageBilling({
      timePackSeatHeld: true,
      crossEndpoint: true,
      balance,
      transactions,
      context: 'message',
    });
    expect(result).toEqual({
      balance,
      transactions,
      context: 'message',
      shouldMeter: false,
    });
  });

  it('leaves credit traffic unchanged when no seat is held', () => {
    const balance = { enabled: true };
    const result = resolveTimePackUsageBilling({
      timePackSeatHeld: false,
      balance,
      transactions: { enabled: true },
      context: 'message',
    });
    expect(result.shouldMeter).toBe(false);
    expect(result.balance).toBe(balance);
    expect(result.context).toBe('message');
  });
});
