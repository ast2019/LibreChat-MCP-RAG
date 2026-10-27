import { defaultRate as chatDefaultRate } from '@librechat/data-schemas';
import type { DocumentOcrConfig, DocumentTextResult, OcrRoute } from './types';
import { OcrError } from './types';

/** Balance unit used by chat billing: 1,000,000 credits = 1 USD at selling price. */
export const CREDITS_PER_USD = 1_000_000;

/** USD per 1M tokens with the endpoint's `priceMultiplier` already applied (= credits per token). */
export interface OcrTokenRates {
  prompt: number;
  completion: number;
}

export type OcrTokenRateLookup = (endpoint: string, model: string) => OcrTokenRates | undefined;

export interface OcrPrices {
  /** Same rates chat billing uses for this endpoint + model (its `endpointTokenConfig`). */
  tokenConfig: OcrTokenRateLookup;
  /** USD per locally OCR'd page. */
  localPricePerPage: number;
  /** Rate for models missing from `tokenConfig`; defaults to chat billing's `defaultRate`. */
  defaultRate?: number;
}

export interface OcrPriceLine {
  kind: 'vision' | 'local';
  endpoint?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  promptRate?: number;
  completionRate?: number;
  /** `default` when the model had no token price and the default rate was charged. */
  rateSource?: 'tokenConfig' | 'default';
  pages?: number;
  credits: number;
}

export interface OcrPrice {
  credits: number;
  lines: OcrPriceLine[];
}

function resolveRates(
  prices: OcrPrices,
  endpoint: string,
  model: string,
): { rates: OcrTokenRates; source: 'tokenConfig' | 'default' } {
  const rates = prices.tokenConfig(endpoint, model);
  if (rates) {
    return { rates, source: 'tokenConfig' };
  }
  const fallback = prices.defaultRate ?? chatDefaultRate;
  return { rates: { prompt: fallback, completion: fallback }, source: 'default' };
}

/** Local pages in credits, with float noise from the USD decimal removed. */
function localCredits(pages: number, pricePerPage: number): number {
  return Math.round(pages * pricePerPage * CREDITS_PER_USD * 1e6) / 1e6;
}

/**
 * Prices an extraction exactly like chat billing prices tokens: `tokens × rate` per token type,
 * where the rate is USD per 1M tokens incl. the multiplier (chat's `tokenValue = rawAmount × rate`).
 * Local pages cost `pages × pricePerPage` USD. Text-layer pages are free.
 */
export function priceOcr(result: DocumentTextResult, prices: OcrPrices): OcrPrice {
  const lines: OcrPriceLine[] = [];
  for (const usage of result.usage) {
    const { rates, source } = resolveRates(prices, usage.endpoint, usage.model);
    const credits = usage.promptTokens * rates.prompt + usage.completionTokens * rates.completion;
    lines.push({
      kind: 'vision',
      endpoint: usage.endpoint,
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      promptRate: rates.prompt,
      completionRate: rates.completion,
      rateSource: source,
      credits,
    });
  }
  if (result.localPages > 0) {
    lines.push({
      kind: 'local',
      pages: result.localPages,
      credits: localCredits(result.localPages, prices.localPricePerPage),
    });
  }
  return { credits: lines.reduce((sum, line) => sum + line.credits, 0), lines };
}

export interface OcrCostEstimateParams {
  /** Pages that may need OCR (an upper bound: text-layer pages turn out free). */
  pages: number;
  route: OcrRoute;
  config: DocumentOcrConfig;
  prices: OcrPrices;
}

export interface OcrCostEstimate {
  credits: number;
  perPage: number;
  pages: number;
}

/** Upper-bound cost for balance pre-checks: `min(pages, maxPages) × per-page estimate`. */
export function estimateOcrCost(params: OcrCostEstimateParams): OcrCostEstimate {
  const { config, prices, route } = params;
  const pages = Math.max(0, Math.min(Math.ceil(params.pages), config.maxPages));

  let perPage: number;
  if (route === 'local') {
    perPage = localCredits(1, prices.localPricePerPage);
  } else {
    const target = config[route];
    if (!target) {
      throw new OcrError('route_not_configured', `documentOcr.${route} is not configured`);
    }
    const { rates } = resolveRates(prices, target.endpoint, target.model);
    perPage =
      config.estimatePromptTokensPerPage * rates.prompt +
      config.estimateCompletionTokensPerPage * rates.completion;
  }
  return { credits: pages * perPage, perPage, pages };
}
