import { resolvePhoneConfigValue, resolvePhoneLoginConfig } from './config';

describe('resolvePhoneConfigValue', () => {
  it('reads an environment reference and treats unset or empty as absent', () => {
    expect(resolvePhoneConfigValue('${KAVENEGAR_TEMPLATE}', { KAVENEGAR_TEMPLATE: 'otp' })).toBe(
      'otp',
    );
    expect(resolvePhoneConfigValue('${KAVENEGAR_TEMPLATE}', {})).toBeUndefined();
    expect(resolvePhoneConfigValue('${KAVENEGAR_TEMPLATE}', { KAVENEGAR_TEMPLATE: ' ' })).toBe(
      undefined,
    );
    expect(resolvePhoneConfigValue('hive-otp', {})).toBe('hive-otp');
    expect(resolvePhoneConfigValue(undefined, {})).toBeUndefined();
  });
});

describe('resolvePhoneLoginConfig', () => {
  const raw = { enabled: true, provider: 'kavenegar' as const, template: '${KAVENEGAR_TEMPLATE}' };

  it('is enabled with a key and a resolved template', () => {
    const config = resolvePhoneLoginConfig(raw, {
      KAVENEGAR_API_KEY: 'key',
      KAVENEGAR_TEMPLATE: 'hive-otp',
    });
    expect(config.enabled).toBe(true);
    expect(config.template).toBe('hive-otp');
  });

  it('stays off without a key, or with neither template nor sender', () => {
    expect(resolvePhoneLoginConfig(raw, { KAVENEGAR_TEMPLATE: 'hive-otp' }).enabled).toBe(false);
    const noTemplate = resolvePhoneLoginConfig(raw, { KAVENEGAR_API_KEY: 'key' });
    expect(noTemplate.enabled).toBe(false);
    expect(noTemplate.template).toBeUndefined();
  });

  it('accepts a sender line instead of a template', () => {
    expect(
      resolvePhoneLoginConfig(
        { enabled: true, provider: 'kavenegar', sender: '10004346' },
        { KAVENEGAR_API_KEY: 'key' },
      ).enabled,
    ).toBe(true);
  });
});
