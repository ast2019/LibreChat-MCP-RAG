import os from 'os';
import path from 'path';
import * as fs from 'fs';
import type { AppConfig } from '@librechat/data-schemas';
import type { DocumentOcrServiceDeps, OcrConversationRecord } from './service';
import type { ServerRequest } from '~/types';
import type { VisionCaller } from './types';
import {
  prepareOcrEmbedding,
  planDocumentOcrUpload,
  conversationReadsPdfs,
  readUploadWithDocumentOcr,
} from './upload';
import { createDocumentOcrService } from './service';
import { OcrError } from './types';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const MODEL = 'google/gemini-3.8-flash';
const specs = [
  { name: 'gemini', preset: { endpoint: 'OpenRouter', model: '~google/gemini-flash-latest' } },
  {
    name: 'private-fast',
    privacy: 'private',
    preset: { endpoint: 'OpenRouterPrivate', model: MODEL },
  },
  { name: 'local', privacy: 'local', preset: { endpoint: 'Local', model: 'hivegpt-local' } },
];

function makeReq(enabled = true, body: Record<string, unknown> = {}): ServerRequest {
  const config = {
    config: {
      documentOcr: {
        enabled,
        public: { endpoint: 'OpenRouter', model: MODEL },
        private: { endpoint: 'OpenRouterPrivate', model: MODEL },
        local: { engine: 'tesseract', languages: 'fas+eng', pricePerPage: 0.00025 },
      },
    },
    modelSpecs: { list: specs },
    balance: { enabled: false },
  } as unknown as AppConfig;
  return { user: { id: 'user-1' }, config, body } as unknown as ServerRequest;
}

function makeService(
  overrides: Partial<DocumentOcrServiceDeps> & { stored?: OcrConversationRecord | null } = {},
) {
  const getConvo = jest.fn(async () => overrides.stored ?? null);
  const spendTokens = jest.fn(async () => undefined);
  const callVision: VisionCaller =
    overrides.callVision ??
    jest.fn(async () => ({
      text: 'متن اسکن‌شده',
      promptTokens: 1000,
      completionTokens: 300,
      estimated: false,
    }));
  const service = createDocumentOcrService({
    getMultiplier: ({ tokenType }) => (tokenType === 'prompt' ? 0.65 : 3.9),
    spendTokens,
    createTransaction: jest.fn(async () => undefined),
    reserveBalance: jest.fn(),
    renewBalanceReservation: jest.fn(),
    releaseBalanceReservation: jest.fn(),
    logViolation: jest.fn(),
    getConvo,
    getEndpointTokenConfig: async () => undefined,
    callVision,
    extract: {
      extractPdfText: async () => ['', ''],
      renderPages: async () => ({
        renderPage: async (page: number) => Buffer.from(`p${page}`),
        close: async () => undefined,
      }),
    },
    ...overrides,
  });
  return { service, getConvo, spendTokens, callVision };
}

const pdfFile = { mimetype: 'application/pdf', originalname: 'scan.pdf' };

describe('conversationReadsPdfs', () => {
  const config = { localEndpoints: ['Local'] };
  it('is false on local endpoints and for models the catalogue says lack file input', () => {
    expect(conversationReadsPdfs({ endpoint: 'Local', model: 'x' }, config, () => true)).toBe(
      false,
    );
    expect(conversationReadsPdfs({ endpoint: 'OpenRouter', model: 'm' }, config, () => false)).toBe(
      false,
    );
  });

  it('assumes an unknown model reads PDFs (the native engine is pinned)', () => {
    expect(
      conversationReadsPdfs({ endpoint: 'OpenRouter', model: 'm' }, config, () => undefined),
    ).toBe(true);
    expect(conversationReadsPdfs({ endpoint: 'OpenRouter' }, config, () => false)).toBe(true);
  });
});

describe('planDocumentOcrUpload', () => {
  it('is null when documentOcr is off', async () => {
    const { service, getConvo } = makeService();
    const plan = await planDocumentOcrUpload({
      req: makeReq(false),
      metadata: { endpoint: 'OpenRouter', conversationId: 'c1' },
      file: pdfFile,
      service,
    });
    expect(plan).toBeNull();
    expect(getConvo).not.toHaveBeenCalled();
  });

  it('routes a PDF for a model without file input to text', async () => {
    const { service } = makeService();
    const plan = await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'OpenRouter', model: 'deepseek/deepseek-v4' },
      file: pdfFile,
      service,
      acceptsFiles: () => false,
    });
    expect(plan).toEqual({ route: 'public', forceText: true });
  });

  it('keeps the provider path when the capability is unknown or the user chose a destination', async () => {
    const { service } = makeService();
    const unknown = await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'OpenRouter', model: 'new/model' },
      file: pdfFile,
      service,
      acceptsFiles: () => undefined,
    });
    expect(unknown?.forceText).toBe(false);

    const chosen = await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'OpenRouter', model: 'm', tool_resource: 'execute_code' },
      file: pdfFile,
      service: makeService().service,
      acceptsFiles: () => false,
    });
    expect(chosen?.forceText).toBe(false);
  });

  it('routes local conversations to text and to the local OCR route', async () => {
    const { service } = makeService();
    const plan = await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'Local', spec: 'local', model: 'hivegpt-local' },
      file: pdfFile,
      service,
      acceptsFiles: () => true,
    });
    expect(plan).toEqual({ route: 'local', forceText: true });
  });

  it('never forces images to text', async () => {
    const { service } = makeService();
    const plan = await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'Local' },
      file: { mimetype: 'image/png', originalname: 'a.png' },
      service,
    });
    expect(plan?.forceText).toBe(false);
  });

  it('reads the stored conversation once and lets it win over a public request', async () => {
    const { service, getConvo } = makeService({
      stored: { endpoint: 'OpenRouterPrivate', spec: 'private-fast', model: MODEL },
    });
    const req = makeReq();
    const metadata = { endpoint: 'OpenRouter', spec: 'gemini', conversationId: 'convo-1' };
    const first = await planDocumentOcrUpload({ req, metadata, file: pdfFile, service });
    const second = await planDocumentOcrUpload({ req, metadata, file: pdfFile, service });
    expect(first?.route).toBe('private');
    expect(second?.route).toBe('private');
    expect(getConvo).toHaveBeenCalledTimes(1);
    expect(getConvo).toHaveBeenCalledWith('user-1', 'convo-1');
  });

  it('does not read a conversation for a new chat', async () => {
    const { service, getConvo } = makeService();
    await planDocumentOcrUpload({
      req: makeReq(),
      metadata: { endpoint: 'OpenRouter', conversationId: 'new' },
      file: pdfFile,
      service,
    });
    expect(getConvo).not.toHaveBeenCalled();
  });

  it('refuses file search in a private or local conversation', async () => {
    for (const metadata of [
      { endpoint: 'OpenRouterPrivate', tool_resource: 'file_search' },
      { endpoint: 'OpenRouter', spec: 'local', tool_resource: 'file_search' },
    ]) {
      const { service } = makeService();
      const error = await planDocumentOcrUpload({
        req: makeReq(),
        metadata,
        file: pdfFile,
        service,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OcrError);
      expect(error).toMatchObject({ code: 'private_destination', userErrorStatusCode: 403 });
    }
  });
});

describe('upload extraction', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ocr-upload-'));
    filePath = path.join(dir, 'scan.pdf');
    await fs.promises.writeFile(filePath, '%PDF-fake');
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('reads a scanned PDF for the context path and bills it once', async () => {
    const { service, spendTokens, callVision } = makeService();
    const outcome = await readUploadWithDocumentOcr({
      req: makeReq(),
      file: { path: filePath, ...pdfFile },
      metadata: { endpoint: 'OpenRouter', conversationId: 'convo-9' },
      service,
    });
    expect(callVision).toHaveBeenCalledTimes(2);
    expect(outcome.text).toContain('متن اسکن‌شده');
    expect(outcome.ocr).toEqual({
      pages: 2,
      readPages: 2,
      ocrPages: 2,
      engine: 'vision',
      credits: 2 * (1000 * 0.65 + 300 * 3.9),
      truncated: false,
    });
    expect(spendTokens).toHaveBeenCalledTimes(1);
    expect(spendTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        context: 'ocr',
        model: MODEL,
        endpoint: 'OpenRouter',
        endpointTokenConfig: { [MODEL]: { prompt: 0.65, completion: 3.9 } },
      }),
      { promptTokens: 2000, completionTokens: 600 },
    );
  });

  it('writes the text as a .txt next to the upload for file search, and removes it', async () => {
    const { service } = makeService();
    const embedding = await prepareOcrEmbedding({
      req: makeReq(),
      file: { path: filePath, ...pdfFile },
      plan: { route: 'public', forceText: false },
      service,
      fileId: 'file-1',
    });
    expect(embedding?.file).toMatchObject({
      mimetype: 'text/plain',
      originalname: 'scan.pdf',
      path: path.join(dir, 'ocr-file-1', 'scan.txt'),
    });
    expect(await fs.promises.readFile(embedding!.file.path, 'utf8')).toBe(embedding!.text);
    expect(embedding?.ocr.ocrPages).toBe(2);
    await embedding?.cleanup();
    expect(fs.existsSync(path.join(dir, 'ocr-file-1'))).toBe(false);
  });

  it('keeps the original file when no text was found', async () => {
    const { service } = makeService({
      callVision: async () => ({
        text: '',
        promptTokens: 5,
        completionTokens: 0,
        estimated: false,
      }),
    });
    const embedding = await prepareOcrEmbedding({
      req: makeReq(),
      file: { path: filePath, ...pdfFile },
      plan: { route: 'public', forceText: false },
      service,
      fileId: 'file-2',
    });
    expect(embedding).toBeNull();
  });
});
