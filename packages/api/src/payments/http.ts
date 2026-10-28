import type { DriverContext } from './types';
import { PaymentDriverError } from './errors';

export interface JsonResponse {
  status: number;
  /** Parsed body; null when it was not JSON */
  body: unknown;
}

/**
 * POSTs JSON with a timeout. Network failures and timeouts become `gateway_unreachable`; any
 * HTTP status resolves, because gateways put their error codes in 4xx bodies.
 */
export async function postJson(
  ctx: DriverContext,
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ctx.timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    const reason =
      (error as { name?: string } | null)?.name === 'TimeoutError' ? 'timeout' : 'network';
    throw new PaymentDriverError('gateway_unreachable', `gateway ${reason} error`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** First value of a query/body field as a trimmed string; arrays (repeated params) take the first. */
export function readParam(params: Record<string, unknown>, key: string): string | undefined {
  const raw = Array.isArray(params[key]) ? (params[key] as unknown[])[0] : params[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' || trimmed.length > 200 ? undefined : trimmed;
}

export function readString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}
