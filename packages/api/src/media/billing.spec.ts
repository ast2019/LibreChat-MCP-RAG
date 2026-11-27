import type { ServerRequest } from '~/types';
import { createMediaBilling } from './billing';

const req = { user: { id: 'u1' }, config: {} } as unknown as ServerRequest;
const charge = { model: 'm', endpoint: 'OpenRouter', context: 'speech_generation', conversationId: 'c1' };

function setup(createTransaction = jest.fn(async () => undefined)) {
  const billing = createMediaBilling({
    reserveBalance: jest.fn(),
    renewBalanceReservation: jest.fn(),
    releaseBalanceReservation: jest.fn(),
    logViolation: jest.fn(),
    createTransaction,
  });
  return { billing, createTransaction };
}

describe('media billing refund', () => {
  it('writes a positive credits transaction with the charge context', async () => {
    const { billing, createTransaction } = setup();
    expect(await billing.refund(req, charge, 90_000)).toBe(true);
    expect(createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'u1',
        conversationId: 'c1',
        model: 'm',
        endpoint: 'OpenRouter',
        context: 'speech_generation',
        tokenType: 'credits',
        rawAmount: 90_000,
      }),
    );
  });

  it('is a no-op for zero credits', async () => {
    const { billing, createTransaction } = setup();
    expect(await billing.refund(req, charge, 0)).toBe(true);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('returns false when the ledger write fails', async () => {
    const { billing } = setup(jest.fn(async () => Promise.reject(new Error('db down'))));
    expect(await billing.refund(req, charge, 5)).toBe(false);
  });

  it('record still writes a negative amount', async () => {
    const { billing, createTransaction } = setup();
    await billing.record(req, charge, 7);
    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ rawAmount: -7 }));
  });
});
