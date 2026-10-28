import type { KavenegarFetch } from './kavenegar';
import {
  readKavenegarBalance,
  getKavenegarBalance,
  createKavenegarClient,
  KavenegarRequestError,
  createKavenegarSmsProvider,
} from './kavenegar';

const API_KEY = 'SECRET-KEY-123';

const respond = (body: unknown, status = 200) =>
  jest.fn<ReturnType<KavenegarFetch>, Parameters<KavenegarFetch>>(async () => ({
    status,
    json: async () => body,
  }));

const ok = (entries: unknown) => ({ return: { status: 200, message: 'تایید شد' }, entries });

describe('createKavenegarClient', () => {
  it('calls Verify Lookup with receptor, token and template', async () => {
    const fetch = respond(ok([{ messageid: 1, status: 5 }]));
    const client = createKavenegarClient({ apiKey: API_KEY, fetch });

    const result = await client.verifyLookup({
      receptor: '09121234567',
      token: '123456',
      template: 'hive-login',
    });

    expect(result).toEqual({ ok: true, value: undefined });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(
      `https://api.kavenegar.com/v1/${API_KEY}/verify/lookup.json`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      receptor: '09121234567',
      token: '123456',
      template: 'hive-login',
    });
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });

  it.each([
    [411, 'invalid_receptor'],
    [418, 'insufficient_credit'],
    [424, 'template_not_found'],
    [431, 'invalid_token'],
    [403, 'unauthorized'],
    [500, 'provider_error'],
  ])('maps return.status %p to %p', async (status, code) => {
    const fetch = respond({ return: { status, message: 'x' }, entries: null }, status);
    const client = createKavenegarClient({ apiKey: API_KEY, fetch });
    await expect(
      client.verifyLookup({ receptor: '09121234567', token: '1', template: 't' }),
    ).resolves.toEqual({ ok: false, error: { code, status } });
  });

  it('throws a key-free error on network failure', async () => {
    const fetch = jest.fn(async () => {
      throw new TypeError(`fetch failed for https://api.kavenegar.com/v1/${API_KEY}/x`);
    });
    const client = createKavenegarClient({ apiKey: API_KEY, fetch });
    const error = await client.getAccountInfo().catch((err: Error) => err);
    expect(error).toBeInstanceOf(KavenegarRequestError);
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('throws on a non-envelope body', async () => {
    const client = createKavenegarClient({ apiKey: API_KEY, fetch: respond('<html>') });
    await expect(client.getAccountInfo()).rejects.toBeInstanceOf(KavenegarRequestError);
  });

  it('reports not_configured without calling out when no key is set', async () => {
    const fetch = respond(ok({}));
    const client = createKavenegarClient({ apiKey: '', fetch });
    await expect(client.send({ receptor: '0912', message: 'x' })).resolves.toEqual({
      ok: false,
      error: { code: 'not_configured' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads account info', async () => {
    const fetch = respond(ok({ remaincredit: 1500000, expiredate: 13548889, type: 'master' }));
    const client = createKavenegarClient({ apiKey: API_KEY, fetch });
    await expect(client.getAccountInfo()).resolves.toEqual({
      ok: true,
      value: { remainCreditRial: 1500000, expireDate: 13548889, accountType: 'master' },
    });
    expect(fetch.mock.calls[0][0]).toBe(
      `https://api.kavenegar.com/v1/${API_KEY}/account/info.json`,
    );
  });
});

describe('createKavenegarSmsProvider', () => {
  it('uses Verify Lookup with the national number when a template is set', async () => {
    const fetch = respond(ok([]));
    const sms = createKavenegarSmsProvider({
      client: createKavenegarClient({ apiKey: API_KEY, fetch }),
      template: 'hive-login',
    });
    await expect(sms.sendCode({ phone: '+989121234567', code: '042424' })).resolves.toEqual({
      ok: true,
    });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toContain('/verify/lookup.json');
    expect(url.searchParams.get('receptor')).toBe('09121234567');
    expect(url.searchParams.get('token')).toBe('042424');
  });

  it('falls back to sms/send with the sender when no template is set', async () => {
    const fetch = respond(ok([]));
    const sms = createKavenegarSmsProvider({
      client: createKavenegarClient({ apiKey: API_KEY, fetch }),
      sender: '10004346',
    });
    await sms.sendCode({ phone: '+989121234567', code: '123456' });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toContain('/sms/send.json');
    expect(url.searchParams.get('sender')).toBe('10004346');
    expect(url.searchParams.get('message')).toContain('123456');
  });

  it('passes provider rejections through as a typed failure', async () => {
    const fetch = respond({ return: { status: 418 } }, 418);
    const sms = createKavenegarSmsProvider({
      client: createKavenegarClient({ apiKey: API_KEY, fetch }),
      template: 't',
    });
    await expect(sms.sendCode({ phone: '+989121234567', code: '1' })).resolves.toEqual({
      ok: false,
      error: { code: 'insufficient_credit', status: 418 },
    });
  });
});

describe('getKavenegarBalance', () => {
  it('returns the remaining credit', async () => {
    const result = await getKavenegarBalance({
      apiKey: API_KEY,
      fetch: respond(ok({ remaincredit: 42 })),
    });
    expect(result).toEqual({ ok: true, value: { remainCreditRial: 42 } });
  });

  it('never throws', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('down');
    });
    await expect(getKavenegarBalance({ apiKey: API_KEY, fetch })).resolves.toEqual({
      ok: false,
      error: { code: 'network_error' },
    });
    await expect(getKavenegarBalance({})).resolves.toEqual({
      ok: false,
      error: { code: 'not_configured' },
    });
  });
});

describe('readKavenegarBalance', () => {
  const info = (status: number, entries: unknown) =>
    (async () =>
      new Response(JSON.stringify({ return: { status, message: '' }, entries }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as KavenegarFetch;

  it('is null when Kavenegar has no key', async () => {
    await expect(readKavenegarBalance({})).resolves.toBeNull();
  });

  it('reads the remaining credit in Rial', async () => {
    await expect(
      readKavenegarBalance(
        { KAVENEGAR_API_KEY: 'key' },
        { fetch: info(200, { remaincredit: 1250000, expiredate: 0, type: 'master' }) },
      ),
    ).resolves.toEqual({ remainingRial: 1250000 });
  });

  it('throws a coded error when the key is rejected', async () => {
    await expect(
      readKavenegarBalance({ KAVENEGAR_API_KEY: 'bad' }, { fetch: info(403, null) }),
    ).rejects.toMatchObject({ code: expect.any(String) });
  });
});
