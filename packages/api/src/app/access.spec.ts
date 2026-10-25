import { SystemRoles } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { applyAdminFullAccess, hasAdminFullAccess } from './access';

const restricted = (adminFullAccess?: boolean) =>
  ({
    config: { interface: { modelSelect: false, mascot: false, adminFullAccess } },
    interfaceConfig: {
      modelSelect: false,
      parameters: false,
      presets: false,
      multiConvo: false,
      contextUsage: false,
      contextCost: false,
      buildInfo: false,
      mascot: false,
      customWelcome: 'hi',
    },
    modelSpecs: { enforce: true, prioritize: true, list: [{ name: 'fast', label: 'Fast' }] },
  }) as unknown as AppConfig;

describe('applyAdminFullAccess', () => {
  it('opens the interface and stops enforcing model specs for ADMIN', () => {
    const appConfig = restricted(true);
    const result = applyAdminFullAccess(appConfig, SystemRoles.ADMIN);

    expect(result.interfaceConfig).toEqual({
      modelSelect: true,
      parameters: true,
      presets: true,
      multiConvo: true,
      contextUsage: true,
      contextCost: true,
      buildInfo: true,
      mascot: false,
      customWelcome: 'hi',
    });
    expect(result.modelSpecs).toEqual({
      enforce: false,
      prioritize: true,
      list: [{ name: 'fast', label: 'Fast' }],
    });
  });

  it('never mutates the given (possibly cached) config', () => {
    const appConfig = restricted(true);
    const snapshot = JSON.parse(JSON.stringify(appConfig));
    applyAdminFullAccess(appConfig, SystemRoles.ADMIN);
    expect(appConfig).toEqual(snapshot);
  });

  it.each([
    ['USER with the flag', true, SystemRoles.USER],
    ['an unknown role with the flag', true, 'EDITOR'],
    ['no role with the flag', true, undefined],
    ['ADMIN with the flag off', false, SystemRoles.ADMIN],
    ['ADMIN with the flag unset', undefined, SystemRoles.ADMIN],
  ])('returns the same config for %s', (_label, flag, role) => {
    const appConfig = restricted(flag);
    expect(applyAdminFullAccess(appConfig, role)).toBe(appConfig);
    expect(hasAdminFullAccess(appConfig, role)).toBe(false);
  });

  it('leaves absent model specs absent', () => {
    const appConfig = { ...restricted(true), modelSpecs: undefined } as AppConfig;
    expect(applyAdminFullAccess(appConfig, SystemRoles.ADMIN).modelSpecs).toBeUndefined();
  });
});
