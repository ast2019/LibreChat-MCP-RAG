import type { Response } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import { createAdminPackHandlers, parsePackList } from './catalog';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response['json'];
  return res;
}

const pro = { id: 'pro', label: 'Pro', credits: 30_000_000, grants: { media: true } };

describe('parsePackList', () => {
  it('keeps valid packs and drops empty notes and empty or unset grants', () => {
    expect(
      parsePackList({
        packs: [
          { id: 'starter', label: 'Starter', credits: 4_000_000, description: '  ', grants: {} },
          { ...pro, grants: { media: true, api: null } },
        ],
      }),
    ).toEqual({
      ok: true,
      packs: [{ id: 'starter', label: 'Starter', credits: 4_000_000 }, pro],
    });
  });

  it.each([
    [{}, 'packs_required'],
    [{ packs: [pro, pro] }, 'duplicate_pack_id'],
    [{ packs: [{ ...pro, id: 'Pro!' }] }, 'invalid_id'],
    [{ packs: [{ ...pro, label: '' }] }, 'invalid_label'],
    [{ packs: [{ ...pro, credits: 0 }] }, 'invalid_credits'],
    [{ packs: [{ ...pro, credits: 2_000_000_000 }] }, 'invalid_credits'],
    [{ packs: [{ ...pro, grants: { video: true } }] }, 'invalid_grants'],
  ])('refuses %j with %s', (body, code) => {
    expect(parsePackList(body)).toEqual({ ok: false, code });
  });

  it('accepts an empty list, which removes every pack', () => {
    expect(parsePackList({ packs: [] })).toEqual({ ok: true, packs: [] });
  });
});

describe('createAdminPackHandlers.updatePacks', () => {
  const req = (body: unknown) =>
    ({ body, user: { id: 'admin-1', tenantId: 't1' } }) as unknown as Parameters<
      ReturnType<typeof createAdminPackHandlers>['updatePacks']
    >[0];

  it('stores the list as a base override, drops caches and answers with the new list', async () => {
    let stored: unknown = [];
    const deps = {
      getAppConfig: jest.fn(
        async () =>
          ({ balance: { enabled: true, startBalance: 200_000, packs: stored } }) as AppConfig,
      ),
      patchBaseFields: jest.fn(async (fields: Record<string, unknown>) => {
        stored = fields['balance.packs'];
      }),
      invalidate: jest.fn(),
    };
    const res = mockRes();
    await createAdminPackHandlers(deps).updatePacks(req({ packs: [pro] }), res);
    expect(deps.patchBaseFields).toHaveBeenCalledWith({ 'balance.packs': [pro] });
    expect(deps.invalidate).toHaveBeenCalledWith('t1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: true, packs: [pro], startBalance: 200_000 });
  });

  it('refuses while balance is off and writes nothing', async () => {
    const deps = {
      getAppConfig: jest.fn(async () => ({ balance: { enabled: false } }) as AppConfig),
      patchBaseFields: jest.fn(),
      invalidate: jest.fn(),
    };
    const res = mockRes();
    await createAdminPackHandlers(deps).updatePacks(req({ packs: [pro] }), res);
    expect(res.statusCode).toBe(409);
    expect(deps.patchBaseFields).not.toHaveBeenCalled();
  });

  it('answers a storage failure with a generic 500', async () => {
    const deps = {
      getAppConfig: jest.fn(async () => ({ balance: { enabled: true } }) as AppConfig),
      patchBaseFields: jest.fn().mockRejectedValue(new Error('mongo down')),
      invalidate: jest.fn(),
    };
    const res = mockRes();
    await createAdminPackHandlers(deps).updatePacks(req({ packs: [pro] }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { code: 'packs_update_failed' } });
  });
});
