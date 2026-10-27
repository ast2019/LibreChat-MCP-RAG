import { Readable } from 'stream';
import { Providers } from '@librechat/agents';
import type { AppConfig, IMongoFile } from '@librechat/data-schemas';
import type { StrategyFunctions, ServerRequest } from '~/types';
import type { DocumentOcrService } from './service';
import { encodeAndFormatDocuments } from '~/files/encode/document';
import { createDocumentTextConverter } from './convert';
import { resolveDocumentOcrConfig } from './config';
import { OcrError } from './types';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('~/files/validation', () => ({
  validatePdf: jest.fn(async () => ({ isValid: true })),
  validateBedrockDocument: jest.fn(async () => ({ isValid: true })),
}));

const ocr = {
  pages: 2,
  readPages: 2,
  ocrPages: 2,
  engine: 'vision' as const,
  credits: 1200,
  truncated: false,
};

function makeService(extract: DocumentOcrService['extract']): DocumentOcrService {
  const config = resolveDocumentOcrConfig({
    enabled: true,
    public: { endpoint: 'OpenRouter', model: 'google/gemini-3.8-flash' },
    private: { endpoint: 'OpenRouterPrivate', model: 'google/gemini-3.8-flash' },
  });
  return {
    getConfig: () => config,
    resolveUploadContext: jest.fn(),
    extract,
  };
}

function makeReq(body: Record<string, unknown> = {}): ServerRequest {
  const config = {
    fileConfig: {},
    modelSpecs: {
      list: [
        { name: 'private-smart', privacy: 'private', preset: { endpoint: 'OpenRouterPrivate' } },
      ],
    },
  } as unknown as AppConfig;
  return { user: { id: 'user-1' }, config, body } as unknown as ServerRequest;
}

const pdfFile = (overrides: Partial<IMongoFile> = {}): IMongoFile =>
  ({
    file_id: 'file-1',
    filename: 'scan.pdf',
    filepath: '/uploads/scan.pdf',
    type: 'application/pdf',
    bytes: 9,
    source: 'local',
    ...overrides,
  }) as unknown as IMongoFile;

function strategies() {
  const getDownloadStream = jest.fn(async () => Readable.from([Buffer.from('%PDF-1.4 fake')]));
  const getStrategyFunctions = jest.fn(
    () => ({ getDownloadStream }) as unknown as StrategyFunctions,
  );
  return { getStrategyFunctions, getDownloadStream };
}

const target = { provider: Providers.OPENAI, endpoint: 'OpenRouter', model: 'no-file/model' };

describe('documentOcr at encode time', () => {
  it('sends a PDF as text to a model without file input, extracting and storing it once', async () => {
    const extract = jest.fn(async () => ({
      text: 'متن سند',
      ocr,
      result: {} as never,
      price: { credits: 1200, lines: [] },
    }));
    const saveFileText = jest.fn(async () => true);
    const converter = createDocumentTextConverter({
      service: makeService(extract),
      saveFileText,
      acceptsFiles: () => false,
    });
    const { getStrategyFunctions } = strategies();
    const file = pdfFile();

    const result = await encodeAndFormatDocuments(
      makeReq({ endpoint: 'OpenRouter', conversationId: 'convo-1' }),
      [file],
      target,
      getStrategyFunctions,
      converter,
    );

    expect(result.documents).toEqual([{ type: 'text', text: 'File: "scan.pdf"\n\nمتن سند' }]);
    expect(result.files).toEqual([expect.objectContaining({ file_id: 'file-1' })]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'public',
        mimetype: 'application/pdf',
        conversationId: 'convo-1',
        buffer: Buffer.from('%PDF-1.4 fake'),
      }),
    );
    expect(saveFileText).toHaveBeenCalledWith({ file_id: 'file-1', text: 'متن سند', ocr });
    expect(file).toMatchObject({ text: 'متن سند', ocr });
  });

  it('reuses text stored on the file: no download, no second extraction or charge', async () => {
    const extract = jest.fn();
    const converter = createDocumentTextConverter({
      service: makeService(extract),
      saveFileText: jest.fn(),
      acceptsFiles: () => false,
    });
    const { getStrategyFunctions, getDownloadStream } = strategies();

    const result = await encodeAndFormatDocuments(
      makeReq(),
      [pdfFile({ text: 'قبلاً خوانده شده', ocr } as Partial<IMongoFile>)],
      target,
      getStrategyFunctions,
      converter,
    );

    expect(result.documents).toEqual([
      { type: 'text', text: 'File: "scan.pdf"\n\nقبلاً خوانده شده' },
    ]);
    expect(extract).not.toHaveBeenCalled();
    expect(getDownloadStream).not.toHaveBeenCalled();
  });

  it('shares one extraction between encoders running at once for the same file', async () => {
    let resolveExtract: (value: Awaited<ReturnType<DocumentOcrService['extract']>>) => void = () =>
      undefined;
    const extract = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<DocumentOcrService['extract']>>>((resolve) => {
          resolveExtract = resolve;
        }),
    );
    const converter = createDocumentTextConverter({
      service: makeService(extract),
      saveFileText: jest.fn(),
      acceptsFiles: () => false,
    });
    const req = makeReq();
    const pdf = Buffer.from('x');
    const first = converter.getText(req, pdfFile(), pdf, target);
    const second = converter.getText(req, pdfFile(), pdf, target);
    resolveExtract({ text: 'یک بار', ocr, result: {} as never, price: { credits: 0, lines: [] } });
    await expect(Promise.all([first, second])).resolves.toEqual(['یک بار', 'یک بار']);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('uses the private route when the turn runs a private spec', async () => {
    const extract = jest.fn(async () => ({
      text: 't',
      ocr,
      result: {} as never,
      price: { credits: 0, lines: [] },
    }));
    const converter = createDocumentTextConverter({
      service: makeService(extract),
      saveFileText: jest.fn(),
      acceptsFiles: () => false,
    });
    await converter.getText(makeReq({ spec: 'private-smart' }), pdfFile(), Buffer.from('x'), {
      ...target,
      endpoint: 'OpenRouter',
    });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ route: 'private' }));
  });

  it('keeps native file delivery when the model reads files (or is unknown)', async () => {
    const extract = jest.fn();
    for (const acceptsFiles of [() => true, () => undefined]) {
      const converter = createDocumentTextConverter({
        service: makeService(extract),
        saveFileText: jest.fn(),
        acceptsFiles,
      });
      const { getStrategyFunctions } = strategies();
      const result = await encodeAndFormatDocuments(
        makeReq(),
        [pdfFile()],
        target,
        getStrategyFunctions,
        converter,
      );
      expect(result.documents).toEqual([
        expect.objectContaining({
          type: 'file',
          file: expect.objectContaining({ filename: 'scan.pdf' }),
        }),
      ]);
    }
    expect(extract).not.toHaveBeenCalled();
  });

  it("hands a short balance to chat's own balance error", async () => {
    const balanceError = new Error(JSON.stringify({ type: 'token_balance', balance: 1 }));
    const extract = jest.fn(async () => {
      throw new OcrError('insufficient_balance', 'short', { cause: balanceError });
    });
    const converter = createDocumentTextConverter({
      service: makeService(extract),
      saveFileText: jest.fn(),
      acceptsFiles: () => false,
    });
    await expect(converter.getText(makeReq(), pdfFile(), Buffer.from('x'), target)).rejects.toBe(
      balanceError,
    );
  });
});
