import { logger } from '@librechat/data-schemas';
import { envVarRegex, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { TFileOcr } from 'librechat-data-provider';
import type {
  OcrRoute,
  VisionCaller,
  PageRenderer,
  TesseractRunner,
  DocumentOcrConfig,
  DocumentTextResult,
} from './types';
import type { OcrPrice, OcrPrices, OcrTokenRates } from './pricing';
import type { VisionEndpoint } from './vision';
import { getCustomEndpointConfig } from '~/app/config';
import { estimateOcrCost, priceOcr } from './pricing';
import { normalizePersianText } from './normalize';
import { assessExtractedText } from './quality';
import { extractDocumentText } from './extract';
import { extractPdfPageTexts } from './pdf';
import { isUserProvided } from '~/utils';
import { OcrError } from './types';

/** Transaction context of vision OCR spend (prompt/completion tokens, like chat). */
export const OCR_TRANSACTION_CONTEXT = 'ocr';
/** Transaction context of on-server OCR spend (`tokenType: 'credits'`, no provider cost). */
export const OCR_LOCAL_TRANSACTION_CONTEXT = 'ocr_local';
/** Model recorded on local OCR transactions; priced at exactly 1 credit per credit. */
export const OCR_LOCAL_MODEL = 'tesseract';

/** The spend fields chat billing records, as `spendTokens` takes them. */
export interface OcrSpendTxData {
  user: string;
  conversationId?: string;
  model?: string;
  endpoint?: string;
  context?: string;
  endpointTokenConfig?: Record<string, Record<string, number>> | null;
  balance?: { enabled?: boolean };
  transactions?: { enabled?: boolean };
}

export interface OcrCreditTxData extends OcrSpendTxData {
  tokenType: 'credits';
  rawAmount: number;
}

export interface OcrMultiplierParams {
  model?: string;
  endpoint?: string;
  tokenType?: 'prompt' | 'completion';
  endpointTokenConfig?: Record<string, Record<string, number>>;
}

export interface OcrReservation {
  release: () => Promise<void>;
}

export interface DocumentOcrDeps {
  callVision: VisionCaller;
  /** The `endpointTokenConfig` chat bills `endpoint` with (fetched prices × `priceMultiplier`). */
  getEndpointTokenConfig: (
    endpoint: string,
  ) => Promise<Record<string, Record<string, number>> | undefined>;
  /** Chat billing's rate lookup (`getMultiplier` of the transaction methods). */
  getMultiplier: (params: OcrMultiplierParams) => number;
  /** Holds `credits` until released; throws `OcrError('insufficient_balance')` when short. */
  reserveCredits?: (params: {
    credits: number;
    model: string;
    endpoint: string;
  }) => Promise<OcrReservation>;
  spendTokens: (
    txData: OcrSpendTxData,
    usage: { promptTokens?: number; completionTokens?: number },
  ) => Promise<unknown>;
  createTransaction: (txData: OcrCreditTxData) => Promise<unknown>;
  runTesseract?: TesseractRunner;
  renderPages?: PageRenderer;
  extractPdfText?: (buffer: Buffer) => Promise<string[]>;
}

export interface RunDocumentOcrParams {
  config: DocumentOcrConfig;
  route: OcrRoute;
  user: string;
  conversationId?: string;
  buffer: Buffer;
  mimetype: string;
  filename: string;
  balance?: { enabled?: boolean };
  transactions?: { enabled?: boolean };
  signal?: AbortSignal;
}

export interface DocumentOcrOutcome {
  text: string;
  ocr: TFileOcr;
  result: DocumentTextResult;
  price: OcrPrice;
}

/** Whether `documentOcr` reads this type (PDFs and images). */
export function isDocumentOcrType(mimetype: string | undefined, filename = ''): boolean {
  const base = (mimetype ?? '').split(';')[0].trim().toLowerCase();
  if (base === 'application/pdf' || base.startsWith('image/')) {
    return true;
  }
  return base === 'application/octet-stream' && /\.pdf$/i.test(filename);
}

/** The file record field describing an extraction. */
export function toFileOcr(result: DocumentTextResult, credits: number, maxPages: number): TFileOcr {
  return {
    pages: result.pages,
    readPages: Math.min(result.pages, maxPages),
    ocrPages: result.ocrPages,
    engine: result.engine,
    credits,
    truncated: result.truncated,
  };
}

function countPagesNeedingOcr(rawPages: readonly string[], maxPages: number): number {
  let count = 0;
  const limit = Math.min(rawPages.length, maxPages);
  for (let i = 0; i < limit; i++) {
    if (!assessExtractedText(normalizePersianText(rawPages[i] ?? '')).usable) {
      count++;
    }
  }
  return count;
}

/**
 * Prices with chat's own lookup: `getMultiplier` over the endpoint's `endpointTokenConfig`, which
 * falls back to the standard tables exactly like a chat turn on that model would.
 */
async function buildPrices(
  params: RunDocumentOcrParams,
  deps: DocumentOcrDeps,
): Promise<OcrPrices> {
  const target = params.route === 'local' ? undefined : params.config[params.route];
  const endpointTokenConfig = target
    ? await deps.getEndpointTokenConfig(target.endpoint)
    : undefined;
  const cache = new Map<string, OcrTokenRates>();
  return {
    localPricePerPage: params.config.local?.pricePerPage ?? 0,
    tokenConfig: (endpoint, model) => {
      const key = `${endpoint}\u0000${model}`;
      let rates = cache.get(key);
      if (!rates) {
        const etc = target && endpoint === target.endpoint ? endpointTokenConfig : undefined;
        const rate = (tokenType: 'prompt' | 'completion') =>
          deps.getMultiplier({ model, endpoint, tokenType, endpointTokenConfig: etc });
        rates = { prompt: rate('prompt'), completion: rate('completion') };
        cache.set(key, rates);
      }
      return rates;
    },
  };
}

/**
 * Records an extraction's spend through chat's ledger: one `spendTokens` per vision model with an
 * `endpointTokenConfig` holding exactly the priced rates (so each transaction's `tokenValue` is
 * `-tokens × rate`), and one `credits` transaction for on-server pages.
 */
async function recordOcrSpend(
  price: OcrPrice,
  params: RunDocumentOcrParams,
  deps: DocumentOcrDeps,
): Promise<void> {
  const base = {
    user: params.user,
    conversationId: params.conversationId,
    balance: params.balance,
    transactions: params.transactions,
  };
  for (const line of price.lines) {
    if (line.kind === 'vision' && line.model) {
      await deps.spendTokens(
        {
          ...base,
          model: line.model,
          endpoint: line.endpoint,
          context: OCR_TRANSACTION_CONTEXT,
          endpointTokenConfig: {
            [line.model]: { prompt: line.promptRate ?? 0, completion: line.completionRate ?? 0 },
          },
        },
        { promptTokens: line.promptTokens ?? 0, completionTokens: line.completionTokens ?? 0 },
      );
      continue;
    }
    if (line.kind === 'local' && line.credits > 0) {
      try {
        await deps.createTransaction({
          ...base,
          tokenType: 'credits',
          context: OCR_LOCAL_TRANSACTION_CONTEXT,
          model: OCR_LOCAL_MODEL,
          endpointTokenConfig: { [OCR_LOCAL_MODEL]: { credits: 1 } },
          rawAmount: -line.credits,
        });
      } catch (error) {
        logger.error('[documentOcr] Failed to record local OCR spend', error);
      }
    }
  }
}

/**
 * Reads a PDF or image through `documentOcr` and bills it like chat: the balance is checked
 * against an upper-bound estimate for the pages that need OCR before any call is made, and the
 * spend actually incurred — including the completed calls of a failed or cancelled extraction —
 * is recorded once, before the reservation is released.
 */
export async function runDocumentOcr(
  params: RunDocumentOcrParams,
  deps: DocumentOcrDeps,
): Promise<DocumentOcrOutcome> {
  const { config, route, buffer, mimetype, filename } = params;
  if (!config.enabled) {
    throw new OcrError('disabled', 'Document OCR is disabled');
  }
  if (!isDocumentOcrType(mimetype, filename)) {
    throw new OcrError('unsupported_type', `Files of type ${mimetype} are not supported`);
  }
  const isImage = mimetype.toLowerCase().startsWith('image/');
  const rawPages = isImage ? [] : await (deps.extractPdfText ?? extractPdfPageTexts)(buffer);
  const pagesToOcr = isImage ? 1 : countPagesNeedingOcr(rawPages, config.maxPages);
  const prices = await buildPrices(params, deps);

  let reservation: OcrReservation | undefined;
  if (pagesToOcr > 0 && params.balance?.enabled === true && deps.reserveCredits) {
    const estimate = estimateOcrCost({ pages: pagesToOcr, route, config, prices });
    const target = route === 'local' ? undefined : config[route];
    if (estimate.credits > 0) {
      reservation = await deps.reserveCredits({
        credits: estimate.credits,
        model: target?.model ?? OCR_LOCAL_MODEL,
        endpoint: target?.endpoint ?? OCR_LOCAL_MODEL,
      });
    }
  }

  try {
    let result: DocumentTextResult;
    try {
      result = await extractDocumentText(
        { buffer, mimetype, filename, route, config, signal: params.signal },
        {
          callVision: deps.callVision,
          runTesseract: deps.runTesseract,
          renderPages: deps.renderPages,
          extractPdfText: async () => rawPages,
        },
      );
    } catch (error) {
      if (error instanceof OcrError && error.partial) {
        await recordOcrSpend(priceOcr(error.partial, prices), params, deps);
      }
      throw error;
    }
    const price = priceOcr(result, prices);
    await recordOcrSpend(price, params, deps);
    return {
      text: result.text,
      ocr: toFileOcr(result, price.credits, config.maxPages),
      result,
      price,
    };
  } finally {
    await reservation?.release();
  }
}

/**
 * Server-side credentials of a configured custom endpoint for OCR calls. Endpoints whose key or
 * URL the user provides are not used (OCR runs on the deployment's account), and header
 * templates are not forwarded.
 */
export function resolveOcrVisionEndpoint(
  appConfig: AppConfig | undefined,
  name: string,
): VisionEndpoint | undefined {
  const endpointConfig = getCustomEndpointConfig({ endpoint: name, appConfig });
  if (!endpointConfig) {
    return undefined;
  }
  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  const unresolved = (value: string) => !value || isUserProvided(value) || envVarRegex.test(value);
  if (unresolved(apiKey) || unresolved(baseURL)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(endpointConfig.headers ?? {})) {
    if (typeof value === 'string' && !value.includes('{{') && !envVarRegex.test(value)) {
      headers[key] = value;
    }
  }
  return {
    apiKey,
    baseURL,
    addParams: endpointConfig.addParams as Record<string, unknown> | undefined,
    headers,
  };
}
