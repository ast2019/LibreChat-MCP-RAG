import { Types } from 'mongoose';
import type { TUserModelAccess } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminModelAccessDeps } from './access';
import type { ServerRequest } from '~/types/http';
import { createAdminBulkAccessHandler, createAdminModelAccessHandlers } from './access';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId().toString();

function call(deps: AdminModelAccessDeps, body: unknown, id = userId) {
  const req = { params: { id }, body } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return createAdminModelAccessHandlers(deps)
    .updateModelAccess(req, res)
    .then(() => ({ status, json }));
}

function createDeps(stored: { modelAccess?: TUserModelAccess } | null = {}) {
  return {
    findUserModelAccess: jest.fn().mockResolvedValue(stored),
    saveUserModelAccess: jest.fn((_id: string, modelAccess: TUserModelAccess) =>
      Promise.resolve<{ modelAccess?: TUserModelAccess } | null>({ modelAccess }),
    ),
  } satisfies AdminModelAccessDeps;
}

describe('createAdminModelAccessHandlers.updateModelAccess', () => {
  it('sets one class and keeps the other as stored', async () => {
    const deps = createDeps({ modelAccess: { private: false } });
    const { status, json } = await call(deps, { local: true });

    expect(deps.saveUserModelAccess).toHaveBeenCalledWith(userId, { local: true, private: false });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ id: userId, modelAccess: { local: true, private: false } });
  });

  it('clears an override with null so the user follows the role again', async () => {
    const deps = createDeps({ modelAccess: { local: false, private: true } });
    const { json } = await call(deps, { local: null });

    expect(deps.saveUserModelAccess).toHaveBeenCalledWith(userId, { private: true });
    expect(json).toHaveBeenCalledWith({ id: userId, modelAccess: { private: true } });
  });

  it.each([[{}], [{ local: 'yes' }], [{ local: true, role: 'ADMIN' }], [null]])(
    'rejects an invalid body %j without writing',
    async (body) => {
      const deps = createDeps();
      const { status } = await call(deps, body);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findUserModelAccess).not.toHaveBeenCalled();
      expect(deps.saveUserModelAccess).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed user id', async () => {
    const deps = createDeps();
    const { status } = await call(deps, { local: true }, 'not-an-id');

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.findUserModelAccess).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown user', async () => {
    const deps = createDeps(null);
    const { status } = await call(deps, { private: false });

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.saveUserModelAccess).not.toHaveBeenCalled();
  });

  it('answers 500 without the error text when storage fails', async () => {
    const deps = createDeps();
    deps.saveUserModelAccess.mockRejectedValue(new Error('E11000 secret detail'));
    const { status, json } = await call(deps, { private: false });

    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret detail');
  });
});

describe('createAdminBulkAccessHandler.updateBulkAccess', () => {
  const otherId = new Types.ObjectId().toString();

  function bulkDeps() {
    return {
      findUserModelAccess: jest.fn(async (id: string) =>
        id === userId ? { modelAccess: { local: false } } : null,
      ),
      saveUserModelAccess: jest.fn(async (_id: string, modelAccess: TUserModelAccess) => ({
        modelAccess,
      })),
      saveApiAccess: jest.fn(async (id: string, value: boolean | null) =>
        id === userId ? { apiAccess: value ?? undefined } : null,
      ),
      saveMediaAccess: jest.fn(async () => ({})),
      saveBrowserAccess: jest.fn(async (id: string, value: boolean | null) =>
        id === userId ? { browserAccess: value ?? undefined } : null,
      ),
    };
  }

  it('routes the browser class to its own switch, not the model override', async () => {
    const deps = bulkDeps();
    const { json } = await bulk(deps, {
      userIds: [userId, otherId],
      field: 'browser',
      value: false,
    });
    expect(json).toHaveBeenCalledWith({ updated: 1, notFound: [otherId] });
    expect(deps.saveBrowserAccess).toHaveBeenCalledWith(userId, false);
    expect(deps.saveUserModelAccess).not.toHaveBeenCalled();
  });

  function bulk(deps: ReturnType<typeof bulkDeps>, body: unknown) {
    const req = { body } as unknown as ServerRequest;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    return createAdminBulkAccessHandler(deps)
      .updateBulkAccess(req, res)
      .then(() => ({ status, json }));
  }

  it('sets one switch for every user and names the ones that are gone', async () => {
    const deps = bulkDeps();
    const { status, json } = await bulk(deps, {
      userIds: [userId, otherId],
      field: 'api',
      value: true,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ updated: 1, notFound: [otherId] });
    expect(deps.saveApiAccess).toHaveBeenCalledWith(userId, true);
  });

  it('merges a model class into each user’s stored override, and clears it with null', async () => {
    const deps = bulkDeps();
    await bulk(deps, { userIds: [userId], field: 'private', value: true });
    expect(deps.saveUserModelAccess).toHaveBeenLastCalledWith(userId, {
      local: false,
      private: true,
    });
    await bulk(deps, { userIds: [userId], field: 'local', value: null });
    expect(deps.saveUserModelAccess).toHaveBeenLastCalledWith(userId, {});
  });

  it.each([
    [{ userIds: [], field: 'api', value: true }],
    [{ userIds: ['not-an-id'], field: 'api', value: true }],
    [{ userIds: [userId], field: 'video', value: true }],
    [{ userIds: [userId], field: 'api', value: 'yes' }],
  ])('refuses %j', async (body) => {
    const deps = bulkDeps();
    const { status } = await bulk(deps, body);
    expect(status).toHaveBeenCalledWith(400);
    expect(deps.saveApiAccess).not.toHaveBeenCalled();
  });
});
