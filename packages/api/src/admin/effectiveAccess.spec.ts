import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { RolePermissions } from '@librechat/data-schemas';
import { computeEffectiveAccess, roleAccessFromPermissions } from './effectiveAccess';

describe('roleAccessFromPermissions', () => {
  it('reads the role the way enforcement does', () => {
    expect(roleAccessFromPermissions(undefined)).toEqual({
      local: true,
      private: true,
      api: false,
    });
    expect(
      roleAccessFromPermissions({
        [PermissionTypes.LOCAL_MODELS]: { [Permissions.USE]: false },
        [PermissionTypes.REMOTE_AGENTS]: { [Permissions.USE]: true },
      } as RolePermissions),
    ).toEqual({ local: false, private: true, api: true });
    expect(roleAccessFromPermissions(null)).toEqual({ local: false, private: false, api: false });
  });
});

describe('computeEffectiveAccess', () => {
  const rules = {
    mediaPaidOnly: true,
    packs: [{ id: 'pro', grants: { private: false, media: true } }],
  };
  const role = { local: true, private: true, api: false };

  it('reads the user pack for model classes and API, and the balance pack for media', () => {
    expect(
      computeEffectiveAccess(
        { role: 'USER', packId: 'pro', balance: { packId: 'starter' } },
        rules,
        role,
      ),
    ).toEqual({
      local: { allowed: true, source: 'role' },
      private: { allowed: false, source: 'pack' },
      api: { allowed: false, source: 'role' },
      /** The balance pack (`starter`) says nothing, but any pack is paid */
      media: { allowed: true, source: 'pack' },
    });
  });

  it('gives admins the model classes and media whatever the pack says', () => {
    expect(
      computeEffectiveAccess({ role: 'ADMIN', packId: 'pro', balance: null }, rules, role),
    ).toMatchObject({
      private: { allowed: true, source: 'admin' },
      media: { allowed: true, source: 'admin' },
    });
  });
});
