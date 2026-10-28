import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import type { SpeechFetch } from './client';
import { createHiveSpeechService, STT_TRANSACTION_CONTEXT } from './service';
import { createSpeechProviderClient } from './client';
import { SpeechError } from './types';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const MULTIPLIER = 1.3;
const STT_MODEL = 'google/gemini-3.5-transcribe';
const STT_PRIVATE_MODEL = 'elevenlabs/scribe-v2';
const TTS_MODEL = 'google/gemini-3.8-flash-tts';

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

function makeConfig(balanceEnabled = true): AppConfig {
  const endpoint = (name: string, provider?: Record<string, unknown>) => ({
    name,
    apiKey: 'sk-or-test',
    baseURL: 'https://openrouter.ai/api/v1',
    priceMultiplier: MULTIPLIER,
    models: { default: [] },
    ...(provider && { addParams: { provider } }),
  });
  return {
    endpoints: {
      custom: [
        endpoint('OpenRouter'),
        endpoint('OpenRouterPrivate', { zdr: true, data_collection: 'deny' }),
        { name: 'Local', apiKey: 'ollama', baseURL: 'http://ollama:11434/v1', models: {} },
      ],
    },
    speech: {
      stt: {
        hive: {
          public: { endpoint: 'OpenRouter', model: STT_MODEL },
          private: { endpoint: 'OpenRouterPrivate', model: STT_PRIVATE_MODEL },
        },
      },
      tts: {
        hive: {
          public: { endpoint: 'OpenRouter', model: TTS_MODEL },
          private: { endpoint: 'OpenRouterPrivate', model: TTS_MODEL },
          costLookupDelayMs: 0,
        },
      },
    },
    balance: { enabled: balanceEnabled, startBalance: 0 },
    transactions: { enabled: true },
  } as unknown as AppConfig;
}

function makeReq(userId: string, appConfig = makeConfig()): ServerRequest {
  return { user: { id: userId }, config: appConfig, body: {} } as unknown as ServerRequest;
}

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

type FetchMock = jest.Mock<Promise<Response>, Parameters<SpeechFetch>>;

const mockFetch = (impl: (url: string, init: RequestInit) => Promise<Response>): FetchMock =>
  jest.fn<Promise<Response>, Parameters<SpeechFetch>>(impl);

function makeService(fetchImpl: FetchMock) {
  const logViolation = jest.fn(async () => undefined);
  const getConvo = jest.fn(async () => null);
  const service = createHiveSpeechService({
    getMultiplier: db.getMultiplier as never,
    createTransaction: db.createTransaction,
    reserveBalance: db.reserveBalance,
    renewBalanceReservation: db.renewBalanceReservation,
    releaseBalanceReservation: db.releaseBalanceReservation,
    logViolation,
    getConvo,
    client: createSpeechProviderClient({ fetch: fetchImpl }),
    sleep: async () => undefined,
  });
  return { service, logViolation, getConvo };
}

const transactionsOf = (userId: string) =>
  mongoose.models.Transaction.find({ user: userId }).sort({ _id: 1 }).lean();

const audio = { buffer: Buffer.alloc(8000, 1), mimetype: 'audio/webm;codecs=opus' };

describe('hive speech-to-text', () => {
  it('transcribes Persian through OpenRouter and charges usage.cost × priceMultiplier', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ text: ' سلام دنیا ', usage: { seconds: 4.2, cost: 0.000508 } }),
    );
    const { service } = makeService(fetchImpl);

    const outcome = await service.transcribe({
      req: makeReq(userId),
      ...audio,
      language: 'fa-IR',
      fields: { endpoint: 'OpenRouter' },
    });

    expect(outcome).toMatchObject({ text: 'سلام دنیا', route: 'public', model: STT_MODEL });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: STT_MODEL, language: 'fa' });
    expect(body.input_audio).toEqual({ data: audio.buffer.toString('base64'), format: 'webm' });
    expect(body.provider).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');

    const expected = 0.000508 * MULTIPLIER * 1_000_000;
    expect(outcome.credits).toBeCloseTo(expected, 6);
    const txs = await transactionsOf(userId);
    expect(txs).toEqual([
      expect.objectContaining({
        tokenType: 'credits',
        context: STT_TRANSACTION_CONTEXT,
        model: STT_MODEL,
        endpoint: 'OpenRouter',
        rate: 1,
      }),
    ]);
    expect(txs[0].tokenValue).toBeCloseTo(-expected, 6);
    const balance = await db.findBalanceByUser(userId, { includeReservedCredits: true });
    expect(balance?.tokenCredits).toBeCloseTo(1_000_000 - expected, 6);
    expect(balance?.reservedCredits ?? 0).toBe(0);
  });

  it('sends private conversations to the ZDR endpoint with provider.zdr', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ text: 'خصوصی', usage: { cost: 0.001 } }),
    );
    const { service, getConvo } = makeService(fetchImpl);
    getConvo.mockResolvedValueOnce({ endpoint: 'OpenRouterPrivate' } as never);

    const outcome = await service.transcribe({
      req: makeReq(userId),
      ...audio,
      /** The composer claims a public endpoint; the stored conversation wins. */
      fields: { conversationId: 'c1', endpoint: 'OpenRouter' },
    });

    expect(outcome.route).toBe('private');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe(STT_PRIVATE_MODEL);
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
    expect(body.language).toBe('fa');
  });

  it('never sends audio of a local conversation out', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const fetchImpl = mockFetch(async () => jsonResponse({ text: 'x' }));
    const { service } = makeService(fetchImpl);

    await expect(
      service.transcribe({ req: makeReq(userId), ...audio, fields: { endpoint: 'Local' } }),
    ).rejects.toMatchObject({ code: 'local_route' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await transactionsOf(userId)).toHaveLength(0);
  });

  it('refuses before calling the provider when the balance does not cover the hold', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1 });
    const fetchImpl = mockFetch(async () => jsonResponse({ text: 'x' }));
    const { service, logViolation } = makeService(fetchImpl);

    const error = await service
      .transcribe({ req: makeReq(userId), ...audio, fields: {} })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpeechError);
    expect((error as SpeechError).code).toBe('insufficient_balance');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logViolation).toHaveBeenCalled();
  });

  it('rejects oversized and unsupported uploads with stable codes', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const fetchImpl = mockFetch(async () => jsonResponse({ text: 'x' }));
    const { service } = makeService(fetchImpl);
    const req = makeReq(userId, makeConfig(false));

    await expect(
      service.transcribe({
        req,
        buffer: Buffer.alloc(11 * 1024 * 1024),
        mimetype: 'audio/webm',
        fields: {},
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
    await expect(
      service.transcribe({ req, buffer: Buffer.alloc(10), mimetype: 'text/plain', fields: {} }),
    ).rejects.toMatchObject({ code: 'unsupported_format' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps provider failures without leaking the provider payload', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ error: { message: 'secret upstream detail' } }, { status: 500 }),
    );
    const { service } = makeService(fetchImpl);

    const error = (await service
      .transcribe({ req: makeReq(userId, makeConfig(false)), ...audio, fields: {} })
      .catch((caught: unknown) => caught)) as SpeechError;

    expect(error.code).toBe('provider_failed');
    expect(error.message).not.toContain('secret');
  });

  it('bills a silent take and reports empty_transcript', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const fetchImpl = mockFetch(async () => jsonResponse({ text: '', usage: { cost: 0.0002 } }));
    const { service } = makeService(fetchImpl);

    await expect(
      service.transcribe({ req: makeReq(userId), ...audio, fields: {} }),
    ).rejects.toMatchObject({ code: 'empty_transcript' });
    const txs = await transactionsOf(userId);
    expect(txs[0].tokenValue).toBeCloseTo(-0.0002 * MULTIPLIER * 1_000_000, 6);
  });
});

describe('hive text-to-speech', () => {
  const pcm = Buffer.alloc(48000 * 2, 0); /** 2 s at 24 kHz, 16-bit mono */

  it('returns WAV audio and charges the generation cost × priceMultiplier', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const fetchImpl = mockFetch(async (url: string) => {
      if (url.includes('/generation?id=')) {
        return jsonResponse({ data: { total_cost: 0.0004 } });
      }
      return new Response(pcm, { status: 200, headers: { 'X-Generation-Id': 'gen-1' } });
    });
    const { service } = makeService(fetchImpl);

    const outcome = await service.synthesize({
      req: makeReq(userId),
      text: 'سلام، حال شما چطور است؟',
      voice: 'Leda',
      fields: {},
    });

    expect(outcome.contentType).toBe('audio/wav');
    expect(outcome.audio.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(outcome.audio.byteLength).toBe(pcm.byteLength + 44);
    expect(outcome.voice).toBe('Leda');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ model: TTS_MODEL, voice: 'Leda', response_format: 'pcm' });

    const credits = await outcome.billed;
    expect(credits).toBeCloseTo(0.0004 * MULTIPLIER * 1_000_000, 6);
    const txs = await transactionsOf(userId);
    expect(txs).toEqual([expect.objectContaining({ context: 'tts', model: TTS_MODEL })]);
    expect(txs[0].tokenValue).toBeCloseTo(-credits, 6);
    const balance = await db.findBalanceByUser(userId, { includeReservedCredits: true });
    expect(balance?.reservedCredits ?? 0).toBe(0);
  });

  it('falls back to the audio length × estimate when the cost is not reported', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    await db.upsertBalanceFields(userId, { tokenCredits: 1_000_000 });
    const fetchImpl = mockFetch(async (url: string) =>
      url.includes('/generation')
        ? new Response('{}', { status: 404 })
        : new Response(pcm, { status: 200, headers: { 'X-Generation-Id': 'gen-2' } }),
    );
    const { service } = makeService(fetchImpl);

    const outcome = await service.synthesize({ req: makeReq(userId), text: 'سلام', fields: {} });

    /** 2 s × $0.02/min × 1.3 */
    expect(await outcome.billed).toBeCloseTo((2 / 60) * 0.02 * MULTIPLIER * 1_000_000, 6);
    expect(outcome.voice).toBe('Kore');
  });

  it('keeps local conversations off the server and private ones on ZDR', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const fetchImpl = mockFetch(async () => new Response(pcm, { status: 200 }));
    const { service } = makeService(fetchImpl);
    const req = makeReq(userId, makeConfig(false));

    await expect(
      service.synthesize({ req, text: 'سلام', fields: { endpoint: 'Local' } }),
    ).rejects.toMatchObject({ code: 'local_route' });
    expect(fetchImpl).not.toHaveBeenCalled();

    await service.synthesize({ req, text: 'سلام', fields: { endpoint: 'OpenRouterPrivate' } });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
  });
});
