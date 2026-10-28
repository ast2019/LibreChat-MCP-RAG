import type { OtpStore, PhoneOtpPolicy, SmsProvider } from './types';
import { createPhoneOtpService, normalizeOtpCode } from './otp';

const PHONE = '+989121234567';
const policy: PhoneOtpPolicy = { codeTtlSeconds: 120, resendCooldownSeconds: 60, maxAttempts: 5 };

/** In-memory store honouring TTLs against the injected clock. */
function createStore(clock: { now: number }) {
  const map = new Map<string, { value: unknown; expiresAt?: number }>();
  const store: OtpStore & { map: typeof map } = {
    map,
    async get(key) {
      const entry = map.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt != null && entry.expiresAt <= clock.now) {
        map.delete(key);
        return undefined;
      }
      return JSON.parse(JSON.stringify(entry.value));
    },
    async set(key, value, ttl) {
      map.set(key, { value, expiresAt: ttl ? clock.now + ttl : undefined });
      return true;
    },
    async delete(key) {
      return map.delete(key);
    },
  };
  return store;
}

function setup(overrides: { sms?: SmsProvider } = {}) {
  const clock = { now: 1_000_000 };
  const store = createStore(clock);
  const sent: Array<{ phone: string; code: string }> = [];
  const sms: SmsProvider = overrides.sms ?? {
    sendCode: jest.fn(async (input) => {
      sent.push(input);
      return { ok: true } as const;
    }),
  };
  const pad = jest.fn(async () => undefined);
  const service = createPhoneOtpService({
    store,
    sms,
    secret: 'server-secret',
    now: () => clock.now,
    pad,
  });
  return { clock, store, sent, sms, pad, service };
}

describe('createPhoneOtpService', () => {
  it('requires a secret', () => {
    expect(() =>
      createPhoneOtpService({
        store: createStore({ now: 0 }),
        sms: { sendCode: jest.fn() },
        secret: '',
      }),
    ).toThrow();
  });

  it('sends a 6-digit code and verifies it exactly once', async () => {
    const { service, sent } = setup();
    const issued = await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    expect(issued).toEqual({
      ok: true,
      value: { cooldownSeconds: 60, expiresInSeconds: 120, codeLength: 6 },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toMatch(/^\d{6}$/);

    const input = { phone: PHONE, purpose: 'login' as const, code: sent[0].code, policy };
    await expect(service.verifyCode(input)).resolves.toEqual({ ok: true });
    await expect(service.verifyCode(input)).resolves.toEqual({
      ok: false,
      error: { code: 'expired' },
    });
  });

  it('stores neither the code nor the number in the clear', async () => {
    const { service, sent, store } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    const dump = JSON.stringify([...store.map.entries()]);
    expect(dump).not.toContain(sent[0].code);
    expect(dump).not.toContain('9121234567');
  });

  it('accepts Persian digits in the submitted code', async () => {
    const { service, sent } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    const persian = sent[0].code.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'login', code: persian, policy }),
    ).resolves.toEqual({ ok: true });
  });

  it('expires codes after the TTL', async () => {
    const { service, sent, clock } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    clock.now += 120_001;
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'login', code: sent[0].code, policy }),
    ).resolves.toEqual({ ok: false, error: { code: 'expired' } });
  });

  it('locks the code after maxAttempts wrong guesses', async () => {
    const { service, sent } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    const wrong = sent[0].code === '000000' ? '111111' : '000000';
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await service.verifyCode({ phone: PHONE, purpose: 'login', code: wrong, policy }),
      );
    }
    expect(results.slice(0, 4).map((r) => !r.ok && r.error)).toEqual([
      { code: 'invalid', attemptsRemaining: 4 },
      { code: 'invalid', attemptsRemaining: 3 },
      { code: 'invalid', attemptsRemaining: 2 },
      { code: 'invalid', attemptsRemaining: 1 },
    ]);
    expect(results[4]).toEqual({ ok: false, error: { code: 'too_many_attempts' } });
    /** The right code no longer works either. */
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'login', code: sent[0].code, policy }),
    ).resolves.toEqual({ ok: false, error: { code: 'expired' } });
  });

  it('enforces the resend cooldown', async () => {
    const { service, clock, sent } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'login', policy });
    clock.now += 20_000;
    await expect(service.issueCode({ phone: PHONE, purpose: 'login', policy })).resolves.toEqual({
      ok: false,
      error: { code: 'cooldown', retryAfterSeconds: 40 },
    });
    clock.now += 40_001;
    await expect(
      service.issueCode({ phone: PHONE, purpose: 'login', policy }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(sent).toHaveLength(2);
  });

  it('binds codes to their purpose and subject', async () => {
    const { service, sent } = setup();
    await service.issueCode({ phone: PHONE, purpose: 'link', subject: 'user-a', policy });
    const code = sent[0].code;
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'login', code, policy }),
    ).resolves.toEqual({ ok: false, error: { code: 'expired' } });
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'link', subject: 'user-b', code, policy }),
    ).resolves.toEqual({ ok: false, error: { code: 'expired' } });
    await expect(
      service.verifyCode({ phone: PHONE, purpose: 'link', subject: 'user-a', code, policy }),
    ).resolves.toEqual({ ok: true });
  });

  it('answers a non-delivering request exactly like a real one', async () => {
    const { service, sent, pad, store } = setup();
    const result = await service.issueCode({
      phone: PHONE,
      purpose: 'login',
      policy,
      deliver: false,
    });
    expect(result).toEqual({
      ok: true,
      value: { cooldownSeconds: 60, expiresInSeconds: 120, codeLength: 6 },
    });
    expect(sent).toHaveLength(0);
    expect(pad).toHaveBeenCalledTimes(1);
    expect([...store.map.keys()].some((key) => key.startsWith('otp:'))).toBe(false);
    /** Cooldown applies to both, so a repeat request cannot tell them apart either. */
    await expect(
      service.issueCode({ phone: PHONE, purpose: 'login', policy, deliver: false }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'cooldown' } });
  });

  it('clears the code and cooldown when the provider rejects', async () => {
    const sms: SmsProvider = {
      sendCode: jest.fn(async () => ({
        ok: false,
        error: { code: 'insufficient_credit', status: 418 },
      })),
    };
    const { service, store } = setup({ sms });
    await expect(service.issueCode({ phone: PHONE, purpose: 'login', policy })).resolves.toEqual({
      ok: false,
      error: { code: 'send_failed', providerCode: 'insufficient_credit', status: 418 },
    });
    expect(store.map.size).toBe(0);
  });

  it('rethrows transport failures after cleaning up', async () => {
    const sms: SmsProvider = { sendCode: jest.fn(async () => Promise.reject(new Error('down'))) };
    const { service, store } = setup({ sms });
    await expect(service.issueCode({ phone: PHONE, purpose: 'login', policy })).rejects.toThrow(
      'down',
    );
    expect(store.map.size).toBe(0);
  });
});

describe('normalizeOtpCode', () => {
  it.each([
    ['123456', '123456'],
    [' 123 456 ', '123456'],
    ['۱۲۳۴۵۶', '123456'],
    ['12345', null],
    ['1234567', null],
    ['12a456', null],
  ])('%p → %p', (input, expected) => {
    expect(normalizeOtpCode(input)).toBe(expected);
  });
});
