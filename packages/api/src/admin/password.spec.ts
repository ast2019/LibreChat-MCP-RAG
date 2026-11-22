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
    awaitAuthUserDocEviction: jest.fn().mockResolvedValue(undefined),
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
  it('stores the hash, retires old tokens, ends the sessions and evicts the cached user', async () => {
    const { deps, handler } = setup();
    const before = Date.now();
    const res = await call(handler, { password: 'New-pass-123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id, updated: true, sessionsEnded: true });
    const [savedId, update] = deps.savePassword.mock.calls[0];
    expect(savedId).toBe(id);
    expect(update).toMatchObject({
      password: 'hash:New-pass-123',
      pendingTotpSecret: null,
      pendingBackupCodes: [],
    });
    /** The stamp the JWT and refresh checks compare: tokens issued before it stop working */
    expect(update.credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(deps.endSessions).toHaveBeenCalledWith(id);
    expect(deps.awaitAuthUserDocEviction).toHaveBeenCalledWith(id);
    expect(deps.endSessions.mock.invocationCallOrder[0]).toBeLessThan(
      deps.awaitAuthUserDocEviction.mock.invocationCallOrder[0],
    );
  });

  it('says so when the sessions could not be ended, and still evicts the cached user', async () => {
    const { deps, handler } = setup({
      endSessions: jest.fn().mockRejectedValue(new Error('redis down: secret-host:6379')),
    });
    const res = await call(handler, { password: 'New-pass-123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id, updated: true, sessionsEnded: false });
    expect(JSON.stringify(res.body)).not.toContain('redis');
    expect(deps.awaitAuthUserDocEviction).toHaveBeenCalledWith(id);
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
