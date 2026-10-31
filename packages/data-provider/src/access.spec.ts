import {
  findPackGrants,
  resolveApiAccess,
  resolveMediaAccess,
  resolveModelClassAccess,
  packGrantsSchema,
} from './access';
import { balancePackSchema } from './config';

describe('pack grants', () => {
  it('belong to a pack in the config and reject unknown classes', () => {
    const pack = balancePackSchema.parse({
      id: 'pro',
      label: 'Pro',
      credits: 1,
      grants: { private: true, media: false },
    });
    expect(pack.grants).toEqual({ private: true, media: false });
    expect(packGrantsSchema.safeParse({ video: true }).success).toBe(false);
  });

  it('are found by pack id, never for no pack, `custom` or an unknown id', () => {
    const packs = [{ id: 'pro', grants: { api: true } }, { id: 'starter' }];
    expect(findPackGrants(packs, 'pro')).toEqual({ api: true });
    expect(findPackGrants(packs, 'starter')).toBeUndefined();
    expect(findPackGrants(packs, 'custom')).toBeUndefined();
    expect(findPackGrants(packs, undefined)).toBeUndefined();
    expect(findPackGrants(undefined, 'pro')).toBeUndefined();
  });
});

describe('resolveModelClassAccess', () => {
  it('gives admins both, then the user override, then the pack, then the role', () => {
    expect(
      resolveModelClassAccess({
        isAdmin: true,
        override: false,
        packGrant: false,
        roleAllows: false,
      }),
    ).toEqual({ allowed: true, source: 'admin' });
    expect(
      resolveModelClassAccess({
        isAdmin: false,
        override: false,
        packGrant: true,
        roleAllows: true,
      }),
    ).toEqual({ allowed: false, source: 'user' });
    expect(resolveModelClassAccess({ isAdmin: false, packGrant: true, roleAllows: false })).toEqual(
      {
        allowed: true,
        source: 'pack',
      },
    );
    expect(resolveModelClassAccess({ isAdmin: false, override: null, roleAllows: true })).toEqual({
      allowed: true,
      source: 'role',
    });
  });
});

describe('resolveApiAccess', () => {
  it('lets the user override win, then the pack, then the role', () => {
    expect(resolveApiAccess({ override: true, packGrant: false, roleAllows: false })).toEqual({
      allowed: true,
      source: 'user',
    });
    expect(resolveApiAccess({ packGrant: false, roleAllows: true })).toEqual({
      allowed: false,
      source: 'pack',
    });
    expect(resolveApiAccess({ roleAllows: true })).toEqual({ allowed: true, source: 'role' });
  });
});

describe('resolveMediaAccess', () => {
  const base = { isAdmin: false, paidOnly: true, hasPack: false };

  it('keeps today’s rule when no pack says anything', () => {
    expect(resolveMediaAccess(base)).toEqual({ allowed: false, source: 'rule' });
    expect(resolveMediaAccess({ ...base, hasPack: true })).toEqual({
      allowed: true,
      source: 'pack',
    });
    expect(resolveMediaAccess({ ...base, paidOnly: false })).toEqual({
      allowed: true,
      source: 'rule',
    });
    expect(resolveMediaAccess({ ...base, isAdmin: true })).toEqual({
      allowed: true,
      source: 'admin',
    });
  });

  it('lets a pack withhold or include media, and the user override win over everything', () => {
    expect(resolveMediaAccess({ ...base, hasPack: true, packGrant: false })).toEqual({
      allowed: false,
      source: 'pack',
    });
    expect(resolveMediaAccess({ ...base, hasPack: true, packGrant: true })).toEqual({
      allowed: true,
      source: 'pack',
    });
    expect(resolveMediaAccess({ ...base, isAdmin: true, override: false })).toEqual({
      allowed: false,
      source: 'user',
    });
  });
});
