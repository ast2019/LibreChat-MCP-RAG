import type { TSearchChainProvider } from 'librechat-data-provider';
import type { ProviderFailure } from './types';

/** Quota wording in a 4xx body. Matched only to classify; the text itself is never kept. */
const QUOTA_PATTERN = /credit|quota|run out of searches|usage limit|plan limit|exceeds|balance/i;
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

interface HttpErrorLike {
  code?: string;
  response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  return typeof error === 'object' && error !== null;
}

/** The message a provider put in its error body: Serper `message`, SerpApi `error`, Tavily `detail.error`. */
export function getBodyMessage(data: unknown): string {
  if (typeof data === 'string') {
    return data.slice(0, 500);
  }
  if (typeof data !== 'object' || data === null) {
    return '';
  }
  const body = data as Record<string, unknown>;
  const detail = body.detail;
  const candidates = [
    body.message,
    body.error,
    typeof detail === 'object' && detail !== null
      ? (detail as Record<string, unknown>).error
      : detail,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate.slice(0, 500);
    }
  }
  return '';
}

function parseRetryAfter(headers?: Record<string, unknown>): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const value = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Classifies one provider failure from its HTTP status and body.
 *
 * - Serper: no published error table; an invalid key answers 403 `Unauthorized.`, and an
 *   account without credits answers a 4xx whose message mentions credits.
 * - SerpApi (serpapi.com/api-status-and-error-codes): 429 is either the hourly throughput limit
 *   or «Your account has run out of searches.»; 401 bad key; 403 deleted account.
 * - Tavily (docs.tavily.com, search endpoint): 429 rate limit with `Retry-After`; 432 key or plan
 *   limit; 433 pay-as-you-go limit; 401 bad key.
 * - Any provider: 402 is out of credit; 5xx, timeouts and network errors are transient.
 */
export function classifyProviderError(
  provider: TSearchChainProvider,
  error: unknown,
): ProviderFailure {
  if (!isHttpErrorLike(error)) {
    return { kind: 'transient', code: 'unknown' };
  }
  const status = error.response?.status;
  if (status == null) {
    if (error.code != null && TIMEOUT_CODES.has(error.code)) {
      return { kind: 'transient', code: 'timeout' };
    }
    if (error.code != null && NETWORK_CODES.has(error.code)) {
      return { kind: 'transient', code: 'network' };
    }
    return { kind: 'transient', code: 'unknown' };
  }

  const code = `http_${status}`;
  if (status >= 500) {
    return { kind: 'transient', code };
  }
  const message = getBodyMessage(error.response?.data);
  const retryAfterSeconds = parseRetryAfter(error.response?.headers);
  const mentionsQuota = QUOTA_PATTERN.test(message);

  if (status === 402) {
    return { kind: 'exhausted', code };
  }
  if (provider === 'tavily' && (status === 432 || status === 433)) {
    return { kind: 'exhausted', code: status === 432 ? 'tavily_plan_limit' : 'tavily_paygo_limit' };
  }
  if (status === 429) {
    if (provider === 'serpapi' && /run out of searches/i.test(message)) {
      return { kind: 'exhausted', code: 'serpapi_out_of_searches' };
    }
    if (provider !== 'tavily' && provider !== 'serpapi' && mentionsQuota) {
      return { kind: 'exhausted', code };
    }
    return { kind: 'rate_limited', code, retryAfterSeconds };
  }
  if ((status === 400 || status === 403) && mentionsQuota) {
    return { kind: 'exhausted', code: provider === 'serper' ? 'serper_no_credits' : code };
  }
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', code };
  }
  return { kind: 'invalid', code };
}

/** A secret-free code for a failure that is not an HTTP error (status checks share it). */
export function getFailureCode(error: unknown): string {
  return classifyProviderError('searxng', error).code;
}
