import { Types } from 'mongoose';
import type { TUserModelAccess } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminModelAccessDeps } from './access';
import type { ServerRequest } from '~/types/http';
import { createAdminModelAccessHandlers } from './access';

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
