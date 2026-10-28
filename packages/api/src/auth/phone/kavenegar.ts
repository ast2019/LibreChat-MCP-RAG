import { toIranianNationalMobile } from 'librechat-data-provider';
import type { SmsProvider, SmsSendResult } from './types';

const DEFAULT_BASE_URL = 'https://api.kavenegar.com/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

/** The subset of `fetch` the client uses, so tests and proxies can supply their own. */
export type KavenegarFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface KavenegarClientOptions {
  apiKey: string;
  fetch?: KavenegarFetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Kavenegar `return.status` values the integration distinguishes. Every other non-200 value maps
 * to `provider_error`. See https://kavenegar.com/rest.html (جدول ۱ - کدهای برگشتی).
 */
const KAVENEGAR_STATUS: Record<number, KavenegarErrorCode> = {
  401: 'account_disabled',
  403: 'unauthorized',
  409: 'unavailable',
  411: 'invalid_receptor',
  412: 'invalid_sender',
  418: 'insufficient_credit',
  424: 'template_not_found',
  426: 'unauthorized',
  431: 'invalid_token',
  432: 'template_not_found',
};

export type KavenegarErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'account_disabled'
  | 'unavailable'
  | 'invalid_receptor'
  | 'invalid_sender'
  | 'insufficient_credit'
  | 'template_not_found'
  | 'invalid_token'
  | 'provider_error';

export type KavenegarResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: KavenegarErrorCode; status?: number } };

export interface KavenegarAccountInfo {
  /** Remaining credit in Rial (`entries.remaincredit`). */
  remainCreditRial: number;
  /** Unix seconds (`entries.expiredate`). */
  expireDate?: number;
  /** `master` or `child`. */
  accountType?: string;
}

/**
 * Network or protocol failure talking to Kavenegar. The message never carries the request URL,
 * which embeds the API key.
 */
export class KavenegarRequestError extends Error {
  readonly code = 'kavenegar_request_failed';
  constructor(reason: string) {
    super(`Kavenegar request failed: ${reason}`);
    this.name = 'KavenegarRequestError';
  }
}

interface KavenegarEnvelope {
  return?: { status?: number };
  entries?: unknown;
}

const isEnvelope = (value: unknown): value is KavenegarEnvelope =>
  typeof value === 'object' && value !== null && 'return' in value;

export interface KavenegarClient {
  verifyLookup(input: {
    receptor: string;
    token: string;
    template: string;
  }): Promise<KavenegarResult<void>>;
  send(input: {
    receptor: string;
    message: string;
    sender?: string;
  }): Promise<KavenegarResult<void>>;
  getAccountInfo(): Promise<KavenegarResult<KavenegarAccountInfo>>;
}

/**
 * Minimal Kavenegar REST client. Expected provider rejections come back as a typed result;
 * transport failures (timeout, DNS, non-JSON body) throw `KavenegarRequestError`.
 */
export function createKavenegarClient(options: KavenegarClientOptions): KavenegarClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: KavenegarFetch = options.fetch ?? (globalThis.fetch as unknown as KavenegarFetch);

  const call = async (
    method: string,
    params: Record<string, string | undefined>,
  ): Promise<KavenegarResult<unknown>> => {
    if (!options.apiKey) {
      return { ok: false, error: { code: 'not_configured' } };
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    const url = `${baseUrl}/${encodeURIComponent(options.apiKey)}/${method}.json${qs ? `?${qs}` : ''}`;

    let body: unknown;
    try {
      const response = await doFetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      body = await response.json();
    } catch (err) {
      const reason = err instanceof Error && err.name ? err.name : 'network';
      throw new KavenegarRequestError(reason);
    }

    if (!isEnvelope(body) || typeof body.return?.status !== 'number') {
      throw new KavenegarRequestError('unexpected response');
    }
    const status = body.return.status;
    if (status === 200) {
      return { ok: true, value: body.entries };
    }
    return { ok: false, error: { code: KAVENEGAR_STATUS[status] ?? 'provider_error', status } };
  };

  return {
    async verifyLookup({ receptor, token, template }) {
      const result = await call('verify/lookup', { receptor, token, template });
      return result.ok ? { ok: true, value: undefined } : result;
    },
    async send({ receptor, message, sender }) {
      const result = await call('sms/send', { receptor, message, sender });
      return result.ok ? { ok: true, value: undefined } : result;
    },
    async getAccountInfo() {
      const result = await call('account/info', {});
      if (!result.ok) {
        return result;
      }
      const entries = (result.value ?? {}) as Record<string, unknown>;
      const remain = Number(entries.remaincredit);
      if (!Number.isFinite(remain)) {
        throw new KavenegarRequestError('unexpected response');
      }
      return {
        ok: true,
        value: {
          remainCreditRial: remain,
          ...(typeof entries.expiredate === 'number' ? { expireDate: entries.expiredate } : {}),
          ...(typeof entries.type === 'string' ? { accountType: entries.type } : {}),
        },
      };
    },
  };
}

export interface KavenegarSmsProviderOptions {
  client: KavenegarClient;
  /** Verify Lookup template; preferred, since lookup messages bypass promotional filtering. */
  template?: string;
  /** Sender line for the `sms/send` fallback when no template is configured. */
  sender?: string;
  /** Message body for the `sms/send` fallback. */
  formatMessage?: (code: string) => string;
}

const defaultMessage = (code: string): string => `کد ورود شما: ${code}`;

/** Adapts the Kavenegar client to the provider-neutral `SmsProvider` the OTP service uses. */
export function createKavenegarSmsProvider(options: KavenegarSmsProviderOptions): SmsProvider {
  const { client, template, sender, formatMessage = defaultMessage } = options;
  return {
    async sendCode({ phone, code }): Promise<SmsSendResult> {
      const receptor = toIranianNationalMobile(phone);
      const result = template
        ? await client.verifyLookup({ receptor, token: code, template })
        : await client.send({ receptor, message: formatMessage(code), sender });
      if (result.ok) {
        return { ok: true };
      }
      return { ok: false, error: { code: result.error.code, status: result.error.status } };
    },
  };
}

/**
 * Remaining Kavenegar credit for the admin status panel. Never throws: transport failures come
 * back as `network_error`, and nothing in the result carries the API key or provider payload.
 */
export async function getKavenegarBalance(options: {
  apiKey?: string;
  fetch?: KavenegarFetch;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<
  | { ok: true; value: KavenegarAccountInfo }
  | { ok: false; error: { code: KavenegarErrorCode | 'network_error'; status?: number } }
> {
  if (!options.apiKey) {
    return { ok: false, error: { code: 'not_configured' } };
  }
  try {
    return await createKavenegarClient({ ...options, apiKey: options.apiKey }).getAccountInfo();
  } catch {
    return { ok: false, error: { code: 'network_error' } };
  }
}

/**
 * The SMS balance for the admin status panel: `null` when Kavenegar has no key (not set up),
 * `{ remainingRial }` when read. A rejected key or an outage throws a coded error, so the panel
 * reports it as an error instead of as "not configured".
 */
export async function readKavenegarBalance(
  env: { KAVENEGAR_API_KEY?: string; [name: string]: string | undefined } = process.env,
  options: { fetch?: KavenegarFetch; baseUrl?: string; timeoutMs?: number } = {},
): Promise<{ remainingRial: number } | null> {
  const apiKey = env.KAVENEGAR_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const result = await getKavenegarBalance({ ...options, apiKey });
  if (!result.ok) {
    throw Object.assign(new Error('Kavenegar balance could not be read'), {
      code: result.error.code,
    });
  }
  return { remainingRial: result.value.remainCreditRial };
}
