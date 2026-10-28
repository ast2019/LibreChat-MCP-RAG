import {
  maskPhone,
  toAsciiDigits,
  phoneLoginConfigSchema,
  normalizeIranianMobile,
  toIranianNationalMobile,
} from './phone';

describe('normalizeIranianMobile', () => {
  it.each([
    '09121234567',
    '9121234567',
    '+989121234567',
    '00989121234567',
    '989121234567',
    '۰۹۱۲۱۲۳۴۵۶۷',
    '٠٩١٢١٢٣٤٥٦٧',
    '+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷',
    '0912-123-4567',
    '(0912) 123 4567',
    ' 0912\u200c1234567 ',
  ])('normalizes %p to E.164', (input) => {
    expect(normalizeIranianMobile(input)).toBe('+989121234567');
  });

  it.each([
    '',
    '   ',
    '0912123456',
    '091212345678',
    '02112345678',
    '+982112345678',
    '+14155550123',
    '0098812345678',
    'abc09121234567',
    '+98912123456a',
    '++989121234567',
    '0'.repeat(30),
  ])('rejects %p', (input) => {
    expect(normalizeIranianMobile(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeIranianMobile(undefined)).toBeNull();
    expect(normalizeIranianMobile(9121234567)).toBeNull();
    expect(normalizeIranianMobile({ phone: '09121234567' })).toBeNull();
  });
});

describe('phone helpers', () => {
  it('converts Persian and Arabic digits only', () => {
    expect(toAsciiDigits('کد ۱۲۳ و ٤٥٦')).toBe('کد 123 و 456');
  });

  it('formats the national number Kavenegar expects', () => {
    expect(toIranianNationalMobile('+989121234567')).toBe('09121234567');
  });

  it('masks the middle digits', () => {
    expect(maskPhone('+989121234567')).toBe('+98912***4567');
    expect(maskPhone('+98')).toBe('***');
  });
});

describe('phoneLoginConfigSchema', () => {
  it('defaults to off with the documented levers', () => {
    expect(phoneLoginConfigSchema.parse({})).toEqual({
      enabled: false,
      provider: 'kavenegar',
      codeTtlSeconds: 120,
      resendCooldownSeconds: 60,
      maxAttempts: 5,
      maxRequestsPerPhonePerHour: 5,
      maxRequestsPerIpPerHour: 20,
    });
  });

  it('rejects out-of-range levers', () => {
    expect(phoneLoginConfigSchema.safeParse({ maxAttempts: 0 }).success).toBe(false);
    expect(phoneLoginConfigSchema.safeParse({ codeTtlSeconds: 5 }).success).toBe(false);
    expect(phoneLoginConfigSchema.safeParse({ provider: 'twilio' }).success).toBe(false);
  });
});
