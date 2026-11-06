import type { TServiceStatus, TServiceUnit } from 'librechat-data-provider';
import type { ChainHttp } from '~/web/chain/types';
import { getFailureCode } from '~/web/chain/classify';

/** What one check found; health, estimates and failover state are added by the service. */
export interface ServiceProbe {
  configured: boolean;
  reachable: boolean | null;
  unit?: TServiceUnit;
  remaining?: number | null;
  limit?: number | null;
  usedThisPeriod?: number | null;
  plan?: string | null;
  resetAt?: string | null;
  errorCode?: string | null;
  details?: TServiceStatus['details'];
  models?: TServiceStatus['models'];
  loadedKnown?: boolean;
  /**
   * OpenRouter: whether `remaining`/`limit` are the API key's spending cap or the
   * account wallet. Absent for other services.
   */
  quotaSource?: 'key' | 'account';
  /** OpenRouter account wallet when `remaining` is the key cap. */
  accountRemaining?: number | null;
  accountLimit?: number | null;
  /** OpenRouter API key expiry (`expires_at`); null when the key does not expire. */
  expiresAt?: string | null;
  /** OpenRouter API key creation (`created_at`); absent when unread. */
  createdAt?: string | null;
}

export interface ProbeContext {
  http: ChainHttp;
  timeoutMs: number;
}

type Json = Record<string, unknown>;

export const SERPER_ACCOUNT_URL = 'https://google.serper.dev/account';
export const SERPAPI_ACCOUNT_URL = 'https://serpapi.com/account.json';
export const TAVILY_USAGE_URL = 'https://api.tavily.com/usage';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
/**
 * ISO timestamp when parseable. Accepts ISO strings and unix seconds/ms so OpenRouter field
 * shape drift does not drop expiry/creation to «unknown».
 */
const isoDate = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = str(value)?.trim();
  if (!raw) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return isoDate(Number(raw));
  }
  return Number.isNaN(Date.parse(raw)) ? null : raw;
};

export const UNCONFIGURED: ServiceProbe = { configured: false, reachable: null };

function failed(error: unknown, unit?: TServiceUnit): ServiceProbe {
  return { configured: true, reachable: false, unit, errorCode: getFailureCode(error) };
}

async function getJson(
  ctx: ProbeContext,
  url: string,
  init: { params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Json> {
  const response = await ctx.http.request<unknown>({
    method: 'GET',
    url,
    timeout: ctx.timeoutMs,
    ...init,
  });
  return obj(response.data);
}

/**
 * Serper has no published account API. `GET /account` with `X-API-KEY` exists (it answers 403
 * `Unauthorized.` for a bad key, like `/search`) and returns the credit balance; `balance` and
 * `credits` are both read.
 */
export async function probeSerper(ctx: ProbeContext, apiKey?: string): Promise<ServiceProbe> {
  if (!apiKey) {
    return UNCONFIGURED;
  }
  try {
    const data = await getJson(ctx, SERPER_ACCOUNT_URL, { headers: { 'X-API-KEY': apiKey } });
    return {
      configured: true,
      reachable: true,
      unit: 'credits',
      remaining: num(data.balance) ?? num(data.credits),
      limit: null,
    };
  } catch (error) {
    return failed(error, 'credits');
  }
}

/** SerpApi Account API (serpapi.com/account-api): free, not counted against the quota. */
export async function probeSerpApi(ctx: ProbeContext, apiKey?: string): Promise<ServiceProbe> {
  if (!apiKey) {
    return UNCONFIGURED;
  }
  try {
    const data = await getJson(ctx, SERPAPI_ACCOUNT_URL, { params: { api_key: apiKey } });
    const planLeft = num(data.plan_searches_left);
    const extra = num(data.extra_credits) ?? 0;
    const perMonth = num(data.searches_per_month);
    return {
      configured: true,
      reachable: true,
      unit: 'searches',
      remaining: num(data.total_searches_left) ?? planLeft,
      limit: perMonth != null ? perMonth + extra : null,
      usedThisPeriod: num(data.this_month_usage),
      plan: str(data.plan_name),
      resetAt: str(data.plan_renewal_date),
    };
  } catch (error) {
    return failed(error, 'searches');
  }
}

/** Tavily `GET /usage` (docs.tavily.com): the key's own limit when set, else the plan's. */
export async function probeTavily(ctx: ProbeContext, apiKey?: string): Promise<ServiceProbe> {
  if (!apiKey) {
    return UNCONFIGURED;
  }
  try {
    const data = await getJson(ctx, TAVILY_USAGE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const key = obj(data.key);
    const account = obj(data.account);
    const keyLimit = num(key.limit);
    const limit = keyLimit ?? num(account.plan_limit);
    const used = keyLimit != null ? num(key.usage) : num(account.plan_usage);
    return {
      configured: true,
      reachable: true,
      unit: 'credits',
      remaining: limit != null && used != null ? Math.max(0, limit - used) : null,
      limit,
      usedThisPeriod: used,
      plan: str(account.current_plan),
    };
  } catch (error) {
    return failed(error, 'credits');
  }
}

/**
 * OpenRouter amounts are US dollars. A provisioned key may carry its own spending
 * cap (`GET /key`); that cap is what returns `403 Key limit exceeded`, so it is the
 * primary remaining/limit whenever present. Account wallet (`GET /credits`, management
 * keys only) is reported beside it when available, and alone when the key has no cap.
 */
export async function probeOpenRouter(
  ctx: ProbeContext,
  apiKey?: string,
  managementKey?: string,
): Promise<ServiceProbe> {
  if (!apiKey && !managementKey) {
    return UNCONFIGURED;
  }
  const auth = (key: string) => ({ headers: { Authorization: `Bearer ${key}` } });
  const [credits, key] = await Promise.allSettled([
    getJson(ctx, OPENROUTER_CREDITS_URL, auth((managementKey ?? apiKey) as string)),
    apiKey ? getJson(ctx, OPENROUTER_KEY_URL, auth(apiKey)) : Promise.reject(new Error('no key')),
  ]);
  const keyData = key.status === 'fulfilled' ? obj(key.value.data) : null;
  const creditData = credits.status === 'fulfilled' ? obj(credits.value.data) : null;
  if (!keyData && !creditData) {
    const reason = apiKey && key.status === 'rejected' ? key.reason : null;
    return failed(reason ?? (credits.status === 'rejected' ? credits.reason : null), 'usd');
  }

  const total = num(creditData?.total_credits);
  const totalUsed = num(creditData?.total_usage);
  const accountRemaining =
    total != null && totalUsed != null ? Math.max(0, total - totalUsed) : null;
  const keyLimit = num(keyData?.limit);
  const keyRemaining = num(keyData?.limit_remaining);
  const usedThisPeriod = num(keyData?.usage_monthly) ?? num(keyData?.usage) ?? totalUsed;
  const keyPlan =
    keyData?.is_free_tier === true
      ? 'free'
      : keyLimit != null && keyData?.limit_reset == null
        ? 'no_reset'
        : str(keyData?.limit_reset);
  /** Present on `/key` when the key has an expiry; null means no expiry; omit when unread. */
  const expiresAt =
    keyData != null && Object.prototype.hasOwnProperty.call(keyData, 'expires_at')
      ? isoDate(keyData.expires_at)
      : undefined;
  const createdAt =
    keyData != null && Object.prototype.hasOwnProperty.call(keyData, 'created_at')
      ? isoDate(keyData.created_at)
      : undefined;
  const budget = obj(keyData?.effective_budget);
  const limitResetsAt = isoDate(budget.resets_at);
  const openRouterDates = {
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };

  /** A finite key cap gates chat requests; prefer it over the account wallet. */
  if (keyLimit != null) {
    return {
      configured: true,
      reachable: true,
      unit: 'usd',
      remaining: keyRemaining != null ? Math.max(0, keyRemaining) : null,
      limit: keyLimit,
      usedThisPeriod,
      plan: keyPlan,
      resetAt: limitResetsAt,
      quotaSource: 'key',
      accountRemaining,
      accountLimit: total,
      ...openRouterDates,
    };
  }

  if (accountRemaining != null && total != null) {
    return {
      configured: true,
      reachable: true,
      unit: 'usd',
      remaining: accountRemaining,
      limit: total,
      usedThisPeriod,
      quotaSource: 'account',
      ...openRouterDates,
    };
  }

  return {
    configured: true,
    reachable: true,
    unit: 'usd',
    remaining: null,
    limit: null,
    usedThisPeriod,
    plan: keyPlan,
    quotaSource: keyData ? 'key' : 'account',
    ...openRouterDates,
  };
}

/** SearXNG's `/healthz` answers 200 `OK` when the instance is up. */
export async function probeSearxng(ctx: ProbeContext, instanceUrl?: string): Promise<ServiceProbe> {
  if (!instanceUrl) {
    return UNCONFIGURED;
  }
  const base = instanceUrl.replace(/\/+$/, '').replace(/\/search$/, '');
  try {
    await ctx.http.request({ method: 'GET', url: `${base}/healthz`, timeout: ctx.timeoutMs });
    return { configured: true, reachable: true };
  } catch (error) {
    return failed(error);
  }
}

type LocalModel = NonNullable<TServiceStatus['models']>[number];

const MAX_MODEL_TEXT = 200;
const MAX_MODELS = 200;

/** Upstream text trimmed and capped, or null; never forwards anything but a short string. */
const text = (value: unknown, max = MAX_MODEL_TEXT): string | null => {
  const trimmed = str(value)?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
const size = (value: unknown): number | null => {
  const bytes = num(value);
  return bytes != null && bytes >= 0 ? bytes : null;
};
const date = (value: unknown): string | null => {
  const raw = text(value, 64);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
};
const modelRows = (data: Json): Json[] =>
  Array.isArray(data.models) ? data.models.slice(0, MAX_MODELS).map(obj) : [];
const modelName = (row: Json): string | null => text(row.name) ?? text(row.model);

/**
 * Ollama: `GET /api/tags` lists the installed models (an empty list is reported as an error) and
 * `GET /api/ps` the ones loaded in memory now. A failed `/api/ps` keeps the list and only marks
 * the loaded state as unknown. A loaded model missing from `/api/tags` is listed with
 * `installed: false`. Loaded models come first, then by name.
 */
export async function probeOllama(ctx: ProbeContext, baseUrl?: string): Promise<ServiceProbe> {
  if (!baseUrl) {
    return UNCONFIGURED;
  }
  const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const [tags, ps] = await Promise.allSettled([
    getJson(ctx, `${base}/api/tags`),
    getJson(ctx, `${base}/api/ps`),
  ]);
  if (tags.status === 'rejected') {
    return failed(tags.reason);
  }

  const models = new Map<string, LocalModel>();
  for (const row of modelRows(tags.value)) {
    const name = modelName(row);
    if (!name || models.has(name)) {
      continue;
    }
    const details = obj(row.details);
    models.set(name, {
      name,
      sizeBytes: size(row.size),
      parameterSize: text(details.parameter_size, 32),
      quantization: text(details.quantization_level, 32),
      family: text(details.family, 64),
      modifiedAt: date(row.modified_at),
      loaded: false,
    });
  }
  const installed = models.size;

  const loadedKnown = ps.status === 'fulfilled';
  if (ps.status === 'fulfilled') {
    for (const row of modelRows(ps.value)) {
      const name = modelName(row);
      if (!name) {
        continue;
      }
      const known = models.get(name) ?? models.get(text(row.model) ?? '');
      const details = obj(row.details);
      /** In `/api/ps`, `size` is the memory the loaded model takes, not its size on disk. */
      const loaded = {
        memoryBytes: size(row.size),
        vramBytes: size(row.size_vram),
        expiresAt: date(row.expires_at),
        loaded: true,
      };
      if (known) {
        Object.assign(known, loaded);
        continue;
      }
      models.set(name, {
        name,
        installed: false,
        sizeBytes: null,
        parameterSize: text(details.parameter_size, 32),
        quantization: text(details.quantization_level, 32),
        family: text(details.family, 64),
        modifiedAt: null,
        ...loaded,
      });
    }
  }

  const list = [...models.values()].sort(
    (a, b) => Number(b.loaded) - Number(a.loaded) || a.name.localeCompare(b.name),
  );
  return {
    configured: true,
    reachable: true,
    errorCode: installed === 0 ? 'no_models' : null,
    models: list,
    loadedKnown,
  };
}

export type SmsBalance = { remainingRial: number } | null;

/**
 * Reads an SMS balance in Rial: `{ remainingRial }` (the documented contract), a bare number, or
 * Kavenegar's own `remaincredit`. Null means the SMS provider is not configured.
 */
export function normalizeSmsBalance(value: unknown): { remainingRial: number | null } | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return { remainingRial: num(value) };
  }
  const row = obj(value);
  return { remainingRial: num(row.remainingRial) ?? num(row.remaincredit) ?? num(row.remaining) };
}

/** The SMS (Kavenegar) balance the phone-login module reports, in Rial; null when unconfigured. */
export async function probeSms(getSmsBalance?: () => Promise<unknown>): Promise<ServiceProbe> {
  if (!getSmsBalance) {
    return UNCONFIGURED;
  }
  try {
    const balance = normalizeSmsBalance(await getSmsBalance());
    if (balance == null) {
      return UNCONFIGURED;
    }
    return { configured: true, reachable: true, unit: 'rial', remaining: balance.remainingRial };
  } catch (error) {
    return failed(error, 'rial');
  }
}

/** One gateway as the payments module reports it. */
export interface PaymentGatewayStatus {
  name: string;
  configured?: boolean;
  healthy: boolean;
  errorCode?: string | null;
}

/**
 * Reads the payments module's gateway report: an array of gateways, or `{ gateways: [...] }`.
 * Items without a name are dropped; `healthy` falls back to `ok`.
 */
export function normalizeGateways(report: unknown): PaymentGatewayStatus[] | null {
  const list = Array.isArray(report) ? report : obj(report).gateways;
  if (!Array.isArray(list)) {
    return null;
  }
  return list.flatMap((item) => {
    const row = obj(item);
    const name = str(row.name) ?? str(row.id) ?? str(row.gateway);
    if (!name) {
      return [];
    }
    const errorCode = str(row.errorCode) ?? str(row.code);
    return [
      {
        name,
        configured: typeof row.configured === 'boolean' ? row.configured : undefined,
        healthy: row.healthy === true || row.ok === true,
        errorCode: errorCode && /^[a-z0-9_.-]{1,64}$/i.test(errorCode) ? errorCode : null,
      },
    ];
  });
}

export async function probePayments(
  getPaymentGatewaysStatus?: () => Promise<unknown>,
): Promise<ServiceProbe> {
  if (!getPaymentGatewaysStatus) {
    return UNCONFIGURED;
  }
  try {
    const gateways = normalizeGateways(await getPaymentGatewaysStatus());
    const active = gateways?.filter((gateway) => gateway.configured !== false) ?? [];
    if (active.length === 0) {
      return UNCONFIGURED;
    }
    const healthy = active.some((gateway) => gateway.healthy);
    return {
      configured: true,
      reachable: healthy,
      errorCode: healthy ? null : 'no_healthy_gateway',
      details: active.map(({ name, healthy: ok, errorCode }) => ({ name, healthy: ok, errorCode })),
    };
  } catch (error) {
    return failed(error);
  }
}
