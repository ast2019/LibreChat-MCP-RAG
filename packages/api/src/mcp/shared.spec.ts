import type { IUser } from '@librechat/data-schemas';
import { createSharedMCPPrincipalResolver } from './shared';

const owner = { id: 'owner', email: 'team@example.com', role: 'USER' } as unknown as IUser;
const user = (over: Record<string, unknown> = {}) =>
  ({ id: 'u1', role: 'USER', ...over }) as unknown as IUser;
const config = { sharedOAuth: { ownerEmail: 'Team@Example.com', allow: 'paid' } } as never;

function resolverWith(packId?: string) {
  const deps = {
    findUserByEmail: jest.fn().mockResolvedValue(owner),
    findBalanceByUser: jest.fn().mockResolvedValue(packId ? { packId } : null),
  };
  return { resolve: createSharedMCPPrincipalResolver(deps), deps };
}

describe('shared MCP connection', () => {
  it('runs a paid user on the owner connection', async () => {
    const { resolve, deps } = resolverWith('starter');
    const principal = await resolve({ serverName: 'higgsfield', config, user: user() });
    expect(principal).toEqual({ user: owner, shared: true });
    expect(deps.findUserByEmail).toHaveBeenCalledWith('team@example.com');
  });

  it('keeps free-trial users and the owner on their own connection', async () => {
    const { resolve } = resolverWith();
    expect((await resolve({ serverName: 'h', config, user: user() })).shared).toBe(false);
    expect((await resolve({ serverName: 'h', config, user: owner })).shared).toBe(false);
  });

  it('follows the per-user switch and lets admins in', async () => {
    const { resolve } = resolverWith();
    expect(
      (await resolve({ serverName: 'h', config, user: user({ mediaAccess: true }) })).shared,
    ).toBe(true);
    expect((await resolve({ serverName: 'h', config, user: user({ role: 'ADMIN' }) })).shared).toBe(
      true,
    );
    const paid = resolverWith('starter').resolve;
    expect(
      (await paid({ serverName: 'h', config, user: user({ mediaAccess: false }) })).shared,
    ).toBe(false);
  });

  it('shares nothing without the setting, or when the owner is unknown', async () => {
    const { resolve } = resolverWith('starter');
    expect((await resolve({ serverName: 'h', config: {} as never, user: user() })).shared).toBe(
      false,
    );
    const missing = createSharedMCPPrincipalResolver({
      findUserByEmail: jest.fn().mockResolvedValue(null),
      findBalanceByUser: jest.fn(),
    });
    expect((await missing({ serverName: 'h', config, user: user() })).shared).toBe(false);
    const unresolved = { sharedOAuth: { ownerEmail: '${UNSET_OWNER}' } } as never;
    expect((await resolve({ serverName: 'h', config: unresolved, user: user() })).shared).toBe(
      false,
    );
  });
});
