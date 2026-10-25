import { SystemRoles } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { applyAdminFullAccess } from './admin';

const base = {
  interfaceConfig: { adminFullAccess: true, modelSelect: false, parameters: false, presets: false },
  modelSpecs: { enforce: true, prioritize: true, list: [{ name: 'fast' }] },
} as unknown as AppConfig;

describe('applyAdminFullAccess', () => {
  it('opens the selector, parameters and presets and lifts spec enforcement for ADMIN', () => {
    const config = applyAdminFullAccess(base, SystemRoles.ADMIN);
    expect(config.interfaceConfig).toEqual(
      expect.objectContaining({ modelSelect: true, parameters: true, presets: true }),
    );
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
  });
});
