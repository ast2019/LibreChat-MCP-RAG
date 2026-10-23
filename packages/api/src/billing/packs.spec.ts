import type { TBalancePack } from 'librechat-data-provider';
import {
  grantBalance,
  resolveBalanceGrant,
  MAX_GRANT_CREDITS,
  PACK_GRANT_CONTEXT,
  MANUAL_GRANT_CONTEXT,
} from './packs';

const packs: TBalancePack[] = [
  { id: 'starter', label: 'Starter', credits: 2_000_000 },
  { id: 'pro', label: 'Pro', credits: 15_000_000 },
];

describe('resolveBalanceGrant', () => {
  it('resolves a configured pack', () => {
    expect(resolveBalanceGrant(packs, { packId: 'pro' })).toEqual({
      ok: true,
      value: { credits: 15_000_000, pack: packs[1] },
    });
  });

  it('resolves a raw whole credit amount', () => {
    expect(resolveBalanceGrant(packs, { credits: 1234 })).toEqual({
      ok: true,
      value: { credits: 1234 },
    });
  });

  it.each([
    [{ packId: 'missing' }, 'pack_not_found'],
    [{ packId: 7 }, 'pack_not_found'],
    [{ packId: 'starter', credits: 10 }, 'grant_amount_ambiguous'],
    [{}, 'grant_amount_required'],
    [{ credits: 0 }, 'grant_amount_invalid'],
    [{ credits: -5 }, 'grant_amount_invalid'],
    [{ credits: 1.5 }, 'grant_amount_invalid'],
    [{ credits: '100' }, 'grant_amount_invalid'],
    [{ credits: MAX_GRANT_CREDITS + 1 }, 'grant_amount_invalid'],
  ])('rejects %p with %s', (request, code) => {
    const result = resolveBalanceGrant(packs, request);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('finds no pack when none are configured', () => {
    const result = resolveBalanceGrant(undefined, { packId: 'starter' });
    expect(!result.ok && result.error.code).toBe('pack_not_found');
  });
});

describe('grantBalance', () => {
  const now = new Date('2026-10-23T10:00:00.000Z');

  it('records a pack grant in the ledger and sets the new allotment', async () => {
    const createTransaction = jest.fn().mockResolvedValue({ balance: 2_150_000 });
    const upsertBalanceFields = jest.fn().mockResolvedValue({});

    const result = await grantBalance(
      { createTransaction, upsertBalanceFields, now: () => now },
      { userId: 'u1', credits: 2_000_000, pack: packs[0] },
    );

    expect(createTransaction).toHaveBeenCalledWith({
      user: 'u1',
      tokenType: 'credits',
      context: PACK_GRANT_CONTEXT,
      rawAmount: 2_000_000,
      balance: { enabled: true },
    });
    /** Leftover credits carry over into the new allotment */
    expect(upsertBalanceFields).toHaveBeenCalledWith('u1', {
      packId: 'starter',
      packLabel: 'Starter',
      packAllotment: 2_150_000,
      packGrantedAt: now,
    });
    expect(result).toEqual({
      balance: 2_150_000,
      credits: 2_000_000,
      packAllotment: 2_150_000,
      pack: { id: 'starter', label: 'Starter' },
    });
  });

  it('records a manual grant under its own ledger context', async () => {
    const createTransaction = jest.fn().mockResolvedValue({ balance: 500 });
    const upsertBalanceFields = jest.fn().mockResolvedValue({});

    const result = await grantBalance(
      { createTransaction, upsertBalanceFields, now: () => now },
      { userId: 'u1', credits: 500 },
    );

    expect(createTransaction.mock.calls[0][0].context).toBe(MANUAL_GRANT_CONTEXT);
    expect(upsertBalanceFields).toHaveBeenCalledWith('u1', {
      packId: 'custom',
      packLabel: '',
      packAllotment: 500,
      packGrantedAt: now,
    });
    expect(result.pack).toBeNull();
  });

  it('fails instead of reporting success when the ledger write did not happen', async () => {
    const upsertBalanceFields = jest.fn();
    await expect(
      grantBalance(
        { createTransaction: jest.fn().mockResolvedValue(undefined), upsertBalanceFields },
        { userId: 'u1', credits: 500 },
      ),
    ).rejects.toThrow('Balance grant was not recorded');
    expect(upsertBalanceFields).not.toHaveBeenCalled();
  });
});
