import { createAdminSetPasswordHandler } from './password';

const id = '65f0c2a1b2c3d4e5f6a7b8c9';

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function setup(over: Record<string, unknown> = {}) {
  const deps = {
    findUser: jest.fn().mockResolvedValue({ role: 'USER', email: 'a@x.io', provider: 'local' }),
    hashSecret: jest.fn(async (plain: string) => `hash:${plain}`),
    savePassword: jest.fn().mockResolvedValue({}),
    endSessions: jest.fn().mockResolvedValue({}),
    canManageAdmins: jest.fn().mockResolvedValue(false),
    minPasswordLength: 8,
    ...over,
  };
  return { deps, handler: createAdminSetPasswordHandler(deps as never) };
}

const call = async (handler: ReturnType<typeof setup>['handler'], body: unknown, userId = id) => {
  const res = mockRes();
  await handler({ params: { id: userId }, body, user: { id: 'admin1' } } as never, res as never);
  return res;
};

describe('admin set password', () => {
  it('stores the hash and ends the user’s sessions', async () => {
    const { deps, handler } = setup();
    const res = await call(handler, { password: 'New-pass-123' });
    expect(res.statusCode).toBe(200);
    expect(deps.savePassword).toHaveBeenCalledWith(id, 'hash:New-pass-123');
    expect(deps.endSessions).toHaveBeenCalledWith(id);
  });

  it('refuses short or blank passwords and bad ids without touching the user', async () => {
    const { deps, handler } = setup();
    expect((await call(handler, { password: 'short' })).statusCode).toBe(400);
    expect((await call(handler, { password: '          ' })).statusCode).toBe(400);
    expect((await call(handler, { password: 'New-pass-123' }, 'nope')).statusCode).toBe(400);
    expect(deps.savePassword).not.toHaveBeenCalled();
  });

  it('lets only a role manager change an admin’s password', async () => {
    const admin = { findUser: jest.fn().mockResolvedValue({ role: 'ADMIN', email: 'b@x.io' }) };
    const manager = setup(admin);
    const refused = await call(manager.handler, { password: 'New-pass-123' });
    expect(refused.statusCode).toBe(403);
    expect(manager.deps.savePassword).not.toHaveBeenCalled();

    const full = setup({ ...admin, canManageAdmins: jest.fn().mockResolvedValue(true) });
    expect((await call(full.handler, { password: 'New-pass-123' })).statusCode).toBe(200);
  });

  it('answers 404 for a missing user', async () => {
    const { handler } = setup({ findUser: jest.fn().mockResolvedValue(null) });
    expect((await call(handler, { password: 'New-pass-123' })).statusCode).toBe(404);
  });
});
