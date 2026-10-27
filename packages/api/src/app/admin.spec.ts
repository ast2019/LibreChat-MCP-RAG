import { SystemRoles, Permissions, PermissionTypes } from 'librechat-data-provider';
import type { AppConfig, RolePermissions } from '@librechat/data-schemas';
import {
  applyAdminFullAccess,
  applyAdminOnlySpecs,
  resolvePrivacyAccess,
  applyPrivacyAccessSpecs,
} from './admin';

const base = {
  interfaceConfig: { adminFullAccess: true, modelSelect: false, parameters: false, presets: false },
  modelSpecs: { enforce: true, prioritize: true, list: [{ name: 'fast' }] },
} as unknown as AppConfig;

describe('applyAdminFullAccess', () => {
  it('keeps the user interface and lifts only spec enforcement for ADMIN', () => {
    const config = applyAdminFullAccess(base, SystemRoles.ADMIN);
    expect(config.interfaceConfig).toBe(base.interfaceConfig);
    expect(config.modelSpecs).toEqual(
      expect.objectContaining({ enforce: false, prioritize: true, list: [{ name: 'fast' }] }),
    );
  });

  it('does not mutate the shared config', () => {
    applyAdminFullAccess(base, SystemRoles.ADMIN);
    expect(base.interfaceConfig?.modelSelect).toBe(false);
    expect(base.modelSpecs?.enforce).toBe(true);
  });

  it('returns the config untouched for users and when the flag is off', () => {
    expect(applyAdminFullAccess(base, SystemRoles.USER)).toBe(base);
    expect(applyAdminFullAccess(base, undefined)).toBe(base);
    const off = { ...base, interfaceConfig: { ...base.interfaceConfig, adminFullAccess: false } };
    expect(applyAdminFullAccess(off as AppConfig, SystemRoles.ADMIN)).toBe(off);
  });

  it('adds no modelSpecs when the deployment has none', () => {
    const config = applyAdminFullAccess(
      { interfaceConfig: { adminFullAccess: true } } as unknown as AppConfig,
      SystemRoles.ADMIN,
    );
    expect(config.modelSpecs).toBeUndefined();
    expect(config.interfaceConfig?.modelSelect).toBeUndefined();
  });
});

describe('applyAdminOnlySpecs', () => {
  const withPrivate = {
    modelSpecs: {
      enforce: true,
      list: [{ name: 'fast' }, { name: 'local-uncensored', adminOnly: true }],
    },
  } as unknown as AppConfig;

  it('keeps admin-only specs for ADMIN', () => {
    expect(applyAdminOnlySpecs(withPrivate, SystemRoles.ADMIN)).toBe(withPrivate);
  });

  it('removes them for users and for a caller that names no role', () => {
    for (const role of [SystemRoles.USER, undefined]) {
      const config = applyAdminOnlySpecs(withPrivate, role);
      expect(config.modelSpecs?.list?.map((spec) => spec.name)).toEqual(['fast']);
      expect(config.modelSpecs?.enforce).toBe(true);
    }
    expect(withPrivate.modelSpecs?.list).toHaveLength(2);
  });

  it('returns the config untouched when no spec is admin-only', () => {
    expect(applyAdminOnlySpecs(base, SystemRoles.USER)).toBe(base);
  });
});

describe('applyPrivacyAccessSpecs', () => {
  const config = {
    modelSpecs: {
      enforce: true,
      list: [
        { name: 'fast' },
        { name: 'zdr', privacy: 'private' },
        { name: 'on-prem', privacy: 'local' },
      ],
    },
  } as unknown as AppConfig;
  const names = (result: AppConfig) => result.modelSpecs?.list?.map((spec) => spec.name);

  it('returns the same config when both classes are allowed', () => {
    expect(applyPrivacyAccessSpecs(config, { allowLocal: true, allowPrivate: true })).toBe(config);
  });

  it('removes only the class that is withheld and keeps enforce', () => {
    const noLocal = applyPrivacyAccessSpecs(config, { allowLocal: false, allowPrivate: true });
    expect(names(noLocal)).toEqual(['fast', 'zdr']);
    expect(noLocal.modelSpecs?.enforce).toBe(true);
    expect(
      names(applyPrivacyAccessSpecs(config, { allowLocal: true, allowPrivate: false })),
    ).toEqual(['fast', 'on-prem']);
    expect(
      names(applyPrivacyAccessSpecs(config, { allowLocal: false, allowPrivate: false })),
    ).toEqual(['fast']);
    expect(config.modelSpecs?.list).toHaveLength(3);
  });

  it('leaves a config without privacy specs, or without specs, untouched', () => {
    const plain = { modelSpecs: { list: [{ name: 'fast' }] } } as unknown as AppConfig;
    const none = {} as AppConfig;
    const denied = { allowLocal: false, allowPrivate: false };
    expect(applyPrivacyAccessSpecs(plain, denied)).toBe(plain);
    expect(applyPrivacyAccessSpecs(none, denied)).toBe(none);
  });
});

describe('resolvePrivacyAccess', () => {
  const permissions = (local?: boolean, priv?: boolean) =>
    ({
      ...(local !== undefined && { [PermissionTypes.LOCAL_MODELS]: { [Permissions.USE]: local } }),
      ...(priv !== undefined && { [PermissionTypes.PRIVATE_MODELS]: { [Permissions.USE]: priv } }),
    }) as RolePermissions;

  it('always allows ADMIN, whatever the role or override says', () => {
    expect(
      resolvePrivacyAccess({
        role: SystemRoles.ADMIN,
        permissions: permissions(false, false),
        override: { local: false, private: false },
      }),
    ).toEqual({ allowLocal: true, allowPrivate: true });
  });

  it('follows the role permission when the user has no override', () => {
    expect(
      resolvePrivacyAccess({ role: SystemRoles.USER, permissions: permissions(false, true) }),
    ).toEqual({ allowLocal: false, allowPrivate: true });
  });

  it('treats a permission type the role does not store as granted', () => {
    expect(resolvePrivacyAccess({ role: SystemRoles.USER, permissions: {} })).toEqual({
      allowLocal: true,
      allowPrivate: true,
    });
    expect(resolvePrivacyAccess({ role: SystemRoles.USER })).toEqual({
      allowLocal: true,
      allowPrivate: true,
    });
  });

  it('lets the user override win in both directions, per class', () => {
    expect(
      resolvePrivacyAccess({
        role: SystemRoles.USER,
        permissions: permissions(false, true),
        override: { local: true, private: false },
      }),
    ).toEqual({ allowLocal: true, allowPrivate: false });
    expect(
      resolvePrivacyAccess({
        role: SystemRoles.USER,
        permissions: permissions(false, false),
        override: { private: true },
      }),
    ).toEqual({ allowLocal: false, allowPrivate: true });
  });

  it('withholds both classes when the role could not be read, unless overridden', () => {
    expect(resolvePrivacyAccess({ role: SystemRoles.USER, permissions: null })).toEqual({
      allowLocal: false,
      allowPrivate: false,
    });
    expect(
      resolvePrivacyAccess({
        role: SystemRoles.USER,
        permissions: null,
        override: { local: true },
      }),
    ).toEqual({ allowLocal: true, allowPrivate: false });
  });
});
