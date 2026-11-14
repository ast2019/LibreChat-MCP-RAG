import type { IUser } from '@librechat/data-schemas';
import { createSharedMCPPrincipalResolver } from './shared';

const owner = { id: 'owner', email: 'team@example.com', role: 'USER' } as unknown as IUser;
const user = (over: Record<string, unknown> = {}) =>
  ({ id: 'u1', role: 'USER', ...over }) as unknown as IUser;
const config = { sharedOAuth: { ownerEmail: 'Team@Example.com' } } as never;

function resolverWith(over: Record<string, unknown> = {}) {
  const deps = {
    findUserByEmail: jest.fn().mockResolvedValue(owner),
    ...over,
  };
  return { resolve: createSharedMCPPrincipalResolver(deps as never), deps };
}

describe('shared MCP connection', () => {
  it('runs a granted user on the owner connection', async () => {
    const { resolve, deps } = resolverWith();
    const principal = await resolve({
      serverName: 'higgsfield',
      config,
      user: user({ higgsfieldAccess: true }),
    });
    expect(principal).toEqual({ user: owner, shared: true });
    expect(deps.findUserByEmail).toHaveBeenCalledWith('team@example.com');
  });

  it('keeps users without the switch, paid or not, and the owner on their own connection', async () => {
    const { resolve } = resolverWith();
    expect((await resolve({ serverName: 'h', config, user: user() })).shared).toBe(false);
    expect(
      (await resolve({ serverName: 'h', config, user: user({ mediaAccess: true }) })).shared,
    ).toBe(false);
    expect(
      (await resolve({ serverName: 'h', config, user: user({ higgsfieldAccess: false }) })).shared,
    ).toBe(false);
    expect((await resolve({ serverName: 'h', config, user: owner })).shared).toBe(false);
  });

  it('lets admins in without the switch', async () => {
    const { resolve } = resolverWith();
    expect((await resolve({ serverName: 'h', config, user: user({ role: 'ADMIN' }) })).shared).toBe(
      true,
    );
  });

  it('reads the switch from the database when the request user is stripped', async () => {
    const findSharedAccess = jest.fn().mockResolvedValue(true);
    const { resolve } = resolverWith({ findSharedAccess });
    expect((await resolve({ serverName: 'h', config, user: user() })).shared).toBe(true);
    expect(findSharedAccess).toHaveBeenCalledWith('u1');
  });

  it("prefers the admin panel's owner over the config file's", async () => {
    const other = { id: 'other', email: 'boss@example.com', role: 'ADMIN' } as unknown as IUser;
    const findUserByEmail = jest.fn(async (email: string) =>
      email === 'boss@example.com' ? other : owner,
    );
    const { resolve } = resolverWith({
      findUserByEmail,
      getOwnerEmail: jest.fn().mockResolvedValue(' Boss@Example.com '),
    });
    const principal = await resolve({
      serverName: 'h',
      config,
      user: user({ higgsfieldAccess: true }),
    });
    expect(principal).toEqual({ user: other, shared: true });
  });

  it("prefers the user's own connection and skips an owner who has not connected", async () => {
    const withTokens = (holders: string[]) =>
      resolverWith({
        hasOAuthTokens: jest.fn(async (userId: string) => holders.includes(userId)),
      }).resolve;
    const granted = user({ higgsfieldAccess: true });
    expect((await withTokens(['owner'])({ serverName: 'h', config, user: granted })).shared).toBe(
      true,
    );
    expect(
      (await withTokens(['owner', 'u1'])({ serverName: 'h', config, user: granted })).shared,
    ).toBe(false);
    expect((await withTokens([])({ serverName: 'h', config, user: granted })).shared).toBe(false);
  });

  it('shares nothing without the setting, or when the owner is unknown or unset', async () => {
    const granted = user({ higgsfieldAccess: true });
    const { resolve } = resolverWith();
    expect((await resolve({ serverName: 'h', config: {} as never, user: granted })).shared).toBe(
      false,
    );
    const missing = resolverWith({ findUserByEmail: jest.fn().mockResolvedValue(null) }).resolve;
    expect((await missing({ serverName: 'h', config, user: granted })).shared).toBe(false);
    const unresolved = { sharedOAuth: { ownerEmail: '${UNSET_OWNER}' } } as never;
    expect((await resolve({ serverName: 'h', config: unresolved, user: granted })).shared).toBe(
      false,
    );
  });
});
