import mongoose from 'mongoose';
import { createTxMethods, defaultRate } from '@librechat/data-schemas';
import type { DocumentTextResult } from './types';
import type { OcrPrices } from './pricing';
import { CREDITS_PER_USD, estimateOcrCost, priceOcr } from './pricing';
import { resolveDocumentOcrConfig } from './config';

/** gemini flash at $0.30 / $2.50 per 1M tokens × priceMultiplier 1.3 */
const FLASH = { prompt: 0.39, completion: 3.25 };
const PRIVATE_FLASH = { prompt: 0.39, completion: 3.25 };

const prices: OcrPrices = {
  tokenConfig: (endpoint, model) => {
    if (model !== 'google/gemini-3.8-flash') {
      return undefined;
    }
    return endpoint === 'OpenRouterPrivate' ? PRIVATE_FLASH : FLASH;
  },
  localPricePerPage: 0.00025,
};

const result: DocumentTextResult = {
  text: '',
  pages: 9,
  ocrPages: 7,
  engine: 'mixed',
  usage: [
    {
      endpoint: 'OpenRouter',
      model: 'google/gemini-3.8-flash',
      promptTokens: 1200,
      completionTokens: 800,
      calls: 1,
      estimated: false,
    },
    {
      endpoint: 'OpenRouterPrivate',
      model: 'google/gemini-3.8-flash',
      promptTokens: 2400,
      completionTokens: 1700,
      calls: 2,
      estimated: false,
    },
  ],
  localPages: 4,
  truncated: false,
};

describe('priceOcr', () => {
  it('matches a hand computation (credits = tokens × USD-per-1M rate)', () => {
    const price = priceOcr(result, prices);
    // public:  1200 × 0.39 + 800 × 3.25  = 468 + 2600   = 3068
    // private: 2400 × 0.39 + 1700 × 3.25 = 936 + 5525   = 6461
    // local:   4 pages × $0.00025 × 1e6  = 1000
    expect(price.lines.map((line) => line.credits)).toEqual([
      expect.closeTo(3068, 9),
      expect.closeTo(6461, 9),
      1000,
    ]);
    expect(price.credits).toBeCloseTo(10529, 9);
    expect(price.lines[2]).toEqual({ kind: 'local', pages: 4, credits: 1000 });
    expect(price.lines[0]).toMatchObject({
      kind: 'vision',
      endpoint: 'OpenRouter',
      promptTokens: 1200,
      completionTokens: 800,
      rateSource: 'tokenConfig',
    });
  });

  it('charges exactly what chat billing charges for the same tokens', () => {
    const tx = createTxMethods(mongoose, {
      matchModelName: () => undefined,
      findMatchingPattern: () => undefined,
    });
    const model = 'google/gemini-3.8-flash';
    const endpointTokenConfig = { [model]: FLASH };
    const usage = result.usage[0];
    // createTransaction: tokenValue = rawAmount × getMultiplier(...) per token type
    const chatCredits =
      usage.promptTokens * tx.getMultiplier({ model, tokenType: 'prompt', endpointTokenConfig }) +
      usage.completionTokens *
        tx.getMultiplier({ model, tokenType: 'completion', endpointTokenConfig });
    const { lines } = priceOcr({ ...result, usage: [usage], localPages: 0 }, prices);
    expect(lines[0].credits).toBe(chatCredits);
  });

  it('falls back to chat billing default rate for unpriced models', () => {
    const price = priceOcr(
      {
        ...result,
        localPages: 0,
        usage: [
          { ...result.usage[0], model: 'unknown/model', promptTokens: 10, completionTokens: 5 },
        ],
      },
      prices,
    );
    expect(price.lines[0]).toMatchObject({ rateSource: 'default', credits: 15 * defaultRate });
  });

  it('is free for text-layer-only results', () => {
    expect(priceOcr({ ...result, usage: [], localPages: 0 }, prices)).toEqual({
      credits: 0,
      lines: [],
    });
  });

  it('uses the 1,000,000 credits = 1 USD unit', () => {
    expect(CREDITS_PER_USD).toBe(1_000_000);
  });
});

describe('estimateOcrCost', () => {
  const config = resolveDocumentOcrConfig({
    enabled: true,
    maxPages: 50,
    public: { endpoint: 'OpenRouter', model: 'google/gemini-3.8-flash' },
  });

  it('multiplies pages by the per-page token estimate at the route rates', () => {
    const estimate = estimateOcrCost({ pages: 10, route: 'public', config, prices });
    const perPage = 1500 * 0.39 + 2000 * 3.25;
    expect(estimate.perPage).toBeCloseTo(perPage, 9);
    expect(estimate.credits).toBeCloseTo(10 * perPage, 9);
  });

  it('caps pages at maxPages and prices local pages per page', () => {
    expect(estimateOcrCost({ pages: 80, route: 'local', config, prices })).toEqual({
      credits: 50 * 250,
      perPage: 250,
      pages: 50,
    });
  });

  it('throws for an unconfigured vision route', () => {
    expect(() => estimateOcrCost({ pages: 1, route: 'private', config, prices })).toThrow(
      expect.objectContaining({ code: 'route_not_configured' }),
    );
  });
});
