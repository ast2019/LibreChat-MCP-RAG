import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { VisionCaller, PageRenderer, TesseractRunner } from './types';
import type { ServerRequest } from '~/types';
import { createDocumentOcrService } from './service';
import { priceOcr } from './pricing';
import { OcrError } from './types';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const MODEL = 'google/gemini-3.8-flash';
const MULTIPLIER = 1.3;
/** OpenRouter's USD per 1M tokens for the model; the service receives them already marked up. */
const PROVIDER_PROMPT = 0.5;
const PROVIDER_COMPLETION = 3;
const TOKEN_CONFIG = {
  [MODEL]: { prompt: PROVIDER_PROMPT * MULTIPLIER, completion: PROVIDER_COMPLETION * MULTIPLIER },
};

let mongoServer: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.models.Balance.deleteMany({});
  await mongoose.models.Transaction.deleteMany({});
});

const renderPages: PageRenderer = async () => ({
  renderPage: async (page: number) => Buffer.from(`page-${page}`),
  close: async () => undefined,
});

const visionUsage = (promptTokens: number, completionTokens: number): VisionCaller =>
  jest.fn(async () => ({ text: 'متن صفحه', promptTokens, completionTokens, estimated: false }));

function makeReq(userId: string, balanceEnabled = true): ServerRequest {
  const config = {
    config: {
      documentOcr: {
        enabled: true,
        concurrency: 1,
        public: { endpoint: 'OpenRouter', model: MODEL },
        private: { endpoint: 'OpenRouterPrivate', model: MODEL },
        local: { engine: 'tesseract', languages: 'fas+eng', pricePerPage: 0.00025 },
      },
    },
    balance: { enabled: balanceEnabled, startBalance: 0 },
    transactions: { enabled: true },
  } as unknown as AppConfig;
  return { user: { id: userId }, config, body: {} } as unknown as ServerRequest;
}

function makeService(
  overrides: {
    callVision?: VisionCaller;
    runTesseract?: TesseractRunner;
    pages?: string[];
  } = {},
) {
  const logViolation = jest.fn(async () => undefined);
  const service = createDocumentOcrService({
    getMultiplier: db.getMultiplier,
    spendTokens: db.spendTokens,
    createTransaction: db.createTransaction,
    reserveBalance: db.reserveBalance,
    renewBalanceReservation: db.renewBalanceReservation,
    releaseBalanceReservation: db.releaseBalanceReservation,
    logViolation,
    getConvo: async () => null,
    getEndpointTokenConfig: async (_req, endpoint) =>
      endpoint === 'OpenRouter' || endpoint === 'OpenRouterPrivate' ? TOKEN_CONFIG : undefined,
    callVision: overrides.callVision ?? visionUsage(1200, 600),
    extract: {
      renderPages,
      runTesseract: overrides.runTesseract,
      extractPdfText: async () => overrides.pages ?? ['', '', ''],
    },
  });
  return { service, logViolation };
}

const pdf = {
  buffer: Buffer.from('%PDF-fake'),
  mimetype: 'application/pdf',
  filename: 'scan.pdf',
};

async function transactionsOf(userId: string) {
  return mongoose.models.Transaction.find({ user: userId }).sort({ _id: 1 }).lean();
}

describe('documentOcr billing (MongoDB)', () => {
  it('records vision OCR as chat-priced prompt/completion spend equal to priceOcr', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const { service } = makeService();

    const outcome = await service.extract({ req: makeReq(userId), ...pdf, route: 'public' });

    const promptRate = PROVIDER_PROMPT * MULTIPLIER;
    const completionRate = PROVIDER_COMPLETION * MULTIPLIER;
    const expected = 3 * 1200 * promptRate + 3 * 600 * completionRate;
    expect(outcome.ocr).toEqual({
      pages: 3,
      readPages: 3,
      ocrPages: 3,
      engine: 'vision',
      credits: expected,
      truncated: false,
    });
    expect(outcome.price.credits).toBeCloseTo(
      priceOcr(outcome.result, {
        tokenConfig: () => ({ prompt: promptRate, completion: completionRate }),
        localPricePerPage: 0,
      }).credits,
    );

    const txs = await transactionsOf(userId);
    expect(txs).toHaveLength(2);
    expect(txs).toEqual([
      expect.objectContaining({
        tokenType: 'prompt',
        context: 'ocr',
        model: MODEL,
        endpoint: 'OpenRouter',
        rawAmount: -3600,
        rate: promptRate,
      }),
      expect.objectContaining({
        tokenType: 'completion',
        context: 'ocr',
        model: MODEL,
        endpoint: 'OpenRouter',
        rawAmount: -1800,
        rate: completionRate,
      }),
    ]);
    const spent = txs.reduce((sum, tx) => sum + (tx.tokenValue as number), 0);
    expect(-spent).toBeCloseTo(outcome.ocr.credits, 6);

    const balance = await db.findBalanceByUser(userId);
    expect(balance?.tokenCredits).toBeCloseTo(1_000_000 - outcome.ocr.credits, 6);
  });

  it('bills text-layer pages nothing and only OCRs the scanned page', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const vision = visionUsage(1000, 500);
    const textPage = 'این صفحه لایهٔ متنی سالم دارد و نیازی به خواندن نوری ندارد.';
    const { service } = makeService({ callVision: vision, pages: [textPage, '', textPage] });

    const outcome = await service.extract({ req: makeReq(userId), ...pdf, route: 'private' });

    expect(vision).toHaveBeenCalledTimes(1);
    expect(vision).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'OpenRouterPrivate' }));
    expect(outcome.ocr).toMatchObject({ pages: 3, ocrPages: 1, engine: 'mixed' });
    const txs = await transactionsOf(userId);
    expect(txs.map((tx) => tx.rawAmount)).toEqual([-1000, -500]);
  });

  it('records local pages as one `ocr_local` credits transaction of pages × pricePerPage', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const vision = visionUsage(1, 1);
    const runTesseract: TesseractRunner = async () => ({ text: 'سلام' });
    const { service } = makeService({ callVision: vision, runTesseract });

    const outcome = await service.extract({ req: makeReq(userId), ...pdf, route: 'local' });

    expect(vision).not.toHaveBeenCalled();
    expect(outcome.ocr).toMatchObject({ engine: 'tesseract', ocrPages: 3, credits: 750 });
    const txs = await transactionsOf(userId);
    expect(txs).toEqual([
      expect.objectContaining({
        tokenType: 'credits',
        context: 'ocr_local',
        model: 'tesseract',
        rawAmount: -750,
        tokenValue: -750,
        rate: 1,
      }),
    ]);
    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(1_000_000 - 750);
  });

  it('refuses before any OCR call when the balance does not cover the estimate', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 10 });
    const vision = visionUsage(1200, 600);
    const { service, logViolation } = makeService({ callVision: vision });

    const error = await service
      .extract({ req: makeReq(userId), ...pdf, route: 'public' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OcrError);
    expect((error as OcrError).code).toBe('insufficient_balance');
    expect((error as OcrError).userErrorStatusCode).toBe(402);
    expect(vision).not.toHaveBeenCalled();
    expect(logViolation).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'token_balance',
      expect.objectContaining({ balance: 10 }),
      0,
    );
    expect(await transactionsOf(userId)).toHaveLength(0);
    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(10);
  });

  it('bills only the completed calls when OCR fails mid-way, and releases the hold', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    let calls = 0;
    const vision: VisionCaller = async () => {
      calls++;
      if (calls === 3) {
        throw new OcrError('vision_failed', 'Vision OCR request failed with status 500');
      }
      return { text: 'متن', promptTokens: 1000, completionTokens: 400, estimated: false };
    };
    const { service } = makeService({ callVision: vision, pages: ['', '', '', ''] });

    await expect(
      service.extract({ req: makeReq(userId), ...pdf, route: 'public' }),
    ).rejects.toMatchObject({ code: 'vision_failed' });

    const txs = await transactionsOf(userId);
    expect(txs.map((tx) => [tx.tokenType, tx.rawAmount])).toEqual([
      ['prompt', -2000],
      ['completion', -800],
    ]);
    const charged = 2000 * PROVIDER_PROMPT * MULTIPLIER + 800 * PROVIDER_COMPLETION * MULTIPLIER;
    const balance = await db.findBalanceByUser(userId, { includeReservedCredits: true });
    expect(balance?.tokenCredits).toBeCloseTo(1_000_000 - charged, 6);
    expect(balance?.reservedCredits ?? 0).toBe(0);
  });

  it('records spend without a balance check when balance is off', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const { service, logViolation } = makeService();

    await service.extract({ req: makeReq(userId, false), ...pdf, route: 'public' });

    expect(logViolation).not.toHaveBeenCalled();
    expect(await transactionsOf(userId)).toHaveLength(2);
    expect(await db.findBalanceByUser(userId)).toBeNull();
  });
});
