import type {
  VisionCaller,
  PageRenderer,
  VisionRequest,
  TesseractRunner,
  DocumentOcrConfig,
} from './types';
import { extractDocumentText, pageSeparator } from './extract';
import { resolveDocumentOcrConfig } from './config';
import { shapePersian } from './fixtures.helper';
import { OcrError } from './types';

const TEXT_PAGE = 'این صفحه لایهٔ متنی سالم دارد و نیازی به خواندن نوری ندارد.';
const TEXT_PAGE_2 = 'صفحهٔ دوم هم متن کامل و قابل استفاده‌ای دارد که مستقیم خوانده می‌شود.';

function makeConfig(overrides: Partial<DocumentOcrConfig> = {}): DocumentOcrConfig {
  return {
    ...resolveDocumentOcrConfig({
      enabled: true,
      public: { endpoint: 'OpenRouter', model: 'google/gemini-3.8-flash' },
      private: { endpoint: 'OpenRouterPrivate', model: 'google/gemini-3.8-flash' },
      local: { engine: 'tesseract', languages: 'fas+eng', pricePerPage: 0.00025 },
    }),
    ...overrides,
  };
}

function fakeRenderer(): { render: PageRenderer; rendered: number[]; closed: () => boolean } {
  const rendered: number[] = [];
  let closed = false;
  const render: PageRenderer = async () => ({
    renderPage: async (pageNumber: number) => {
      rendered.push(pageNumber);
      return Buffer.from(`png-${pageNumber}`);
    },
    close: async () => {
      closed = true;
    },
  });
  return { render, rendered, closed: () => closed };
}

function fakeVision(): jest.MockedFunction<VisionCaller> {
  return jest.fn(async (request: VisionRequest) => ({
    text: `متن خوانده‌شده از ${request.image.toString()}`,
    promptTokens: 1000,
    completionTokens: 400,
    estimated: false,
  }));
}

const pdfParams = (pages: string[], overrides: Record<string, unknown> = {}) => ({
  params: {
    buffer: Buffer.from('%PDF-fake'),
    mimetype: 'application/pdf',
    filename: 'doc.pdf',
    route: 'public' as const,
    config: makeConfig(),
    ...overrides,
  },
  extractPdfText: jest.fn(async () => pages),
});

describe('extractDocumentText — PDFs', () => {
  it('uses the text layer for free when every page has usable text', async () => {
    const vision = fakeVision();
    const renderer = fakeRenderer();
    const { params, extractPdfText } = pdfParams([shapePersian(TEXT_PAGE), TEXT_PAGE_2]);
    const progress = jest.fn();

    const result = await extractDocumentText(
      { ...params, onProgress: progress },
      { callVision: vision, renderPages: renderer.render, extractPdfText },
    );

    expect(result).toEqual({
      text: `${TEXT_PAGE}${pageSeparator(2)}${TEXT_PAGE_2}`,
      pages: 2,
      ocrPages: 0,
      engine: 'text',
      usage: [],
      localPages: 0,
      truncated: false,
    });
    expect(vision).not.toHaveBeenCalled();
    expect(renderer.rendered).toEqual([]);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it('OCRs only scanned pages through the public route and aggregates usage', async () => {
    const vision = fakeVision();
    const renderer = fakeRenderer();
    const { params, extractPdfText } = pdfParams([TEXT_PAGE, '', '\uFFFD\uFFFD\uFFFD', '  ']);
    const progress = jest.fn();

    const result = await extractDocumentText(
      { ...params, onProgress: progress },
      { callVision: vision, renderPages: renderer.render, extractPdfText },
    );

    expect(vision).toHaveBeenCalledTimes(3);
    for (const [request] of vision.mock.calls) {
      expect(request).toMatchObject({
        endpoint: 'OpenRouter',
        model: 'google/gemini-3.8-flash',
        mimetype: 'image/png',
      });
    }
    expect(renderer.rendered.sort()).toEqual([2, 3, 4]);
    expect(renderer.closed()).toBe(true);
    expect(result.engine).toBe('mixed');
    expect(result.ocrPages).toBe(3);
    expect(result.localPages).toBe(0);
    expect(result.usage).toEqual([
      {
        endpoint: 'OpenRouter',
        model: 'google/gemini-3.8-flash',
        promptTokens: 3000,
        completionTokens: 1200,
        calls: 3,
        estimated: false,
      },
    ]);
    expect(result.text).toBe(
      [
        TEXT_PAGE,
        pageSeparator(2),
        'متن خوانده‌شده از png-2',
        pageSeparator(3),
        'متن خوانده‌شده از png-3',
        pageSeparator(4),
        'متن خوانده‌شده از png-4',
      ].join(''),
    );
    expect(progress).toHaveBeenNthCalledWith(1, 1, 4);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });

  it('uses the private (ZDR) endpoint on the private route', async () => {
    const vision = fakeVision();
    const { params, extractPdfText } = pdfParams([''], { route: 'private' });
    const result = await extractDocumentText(params, {
      callVision: vision,
      renderPages: fakeRenderer().render,
      extractPdfText,
    });
    expect(vision.mock.calls[0][0].endpoint).toBe('OpenRouterPrivate');
    expect(result.engine).toBe('vision');
    expect(result.usage[0].endpoint).toBe('OpenRouterPrivate');
  });

  it('runs Tesseract on the local route and never calls a vision model', async () => {
    const vision = fakeVision();
    const runTesseract: jest.MockedFunction<TesseractRunner> = jest.fn(async ({ image }) => ({
      text: `خروجی محلی ${image.toString()}`,
    }));
    const { params, extractPdfText } = pdfParams(['', ''], { route: 'local' });

    const result = await extractDocumentText(params, {
      callVision: vision,
      runTesseract,
      renderPages: fakeRenderer().render,
      extractPdfText,
    });

    expect(vision).not.toHaveBeenCalled();
    expect(runTesseract).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ engine: 'tesseract', localPages: 2, ocrPages: 2, usage: [] });
    expect(result.text).toBe(`خروجی محلی png-1${pageSeparator(2)}خروجی محلی png-2`);
  });

  it('stops at maxPages and flags truncation', async () => {
    const vision = fakeVision();
    const renderer = fakeRenderer();
    const { params, extractPdfText } = pdfParams([TEXT_PAGE, '', TEXT_PAGE_2, '', ''], {
      config: makeConfig({ maxPages: 3 }),
    });

    const result = await extractDocumentText(params, {
      callVision: vision,
      renderPages: renderer.render,
      extractPdfText,
    });

    expect(result).toMatchObject({ pages: 5, ocrPages: 1, truncated: true, engine: 'mixed' });
    expect(renderer.rendered).toEqual([2]);
    expect(result.text.split('--- صفحهٔ').length).toBe(3);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const vision: VisionCaller = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { text: '', promptTokens: 1, completionTokens: 1, estimated: false };
    };
    const { params, extractPdfText } = pdfParams(Array(10).fill(''), {
      config: makeConfig({ concurrency: 3 }),
    });
    const result = await extractDocumentText(params, {
      callVision: vision,
      renderPages: fakeRenderer().render,
      extractPdfText,
    });
    expect(peak).toBe(3);
    expect(result.usage[0]).toMatchObject({ calls: 10, promptTokens: 10 });
  });

  it('aborts in-flight OCR, closes the renderer and throws `aborted`', async () => {
    const controller = new AbortController();
    const renderer = fakeRenderer();
    const seen: AbortSignal[] = [];
    const vision: VisionCaller = (request) =>
      new Promise((_resolve, reject) => {
        seen.push(request.signal as AbortSignal);
        request.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        if (seen.length === 2) {
          controller.abort();
        }
      });
    const { params, extractPdfText } = pdfParams(['', '', '', '', ''], {
      signal: controller.signal,
      config: makeConfig({ concurrency: 2 }),
    });

    await expect(
      extractDocumentText(params, {
        callVision: vision,
        renderPages: renderer.render,
        extractPdfText,
      }),
    ).rejects.toMatchObject({ name: 'OcrError', code: 'aborted' });
    expect(seen).toHaveLength(2);
    expect(seen.every((signal) => signal.aborted)).toBe(true);
    expect(renderer.closed()).toBe(true);
  });

  it('throws `aborted` before doing any work when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { params, extractPdfText } = pdfParams(['']);
    await expect(
      extractDocumentText(
        { ...params, signal: controller.signal },
        { callVision: fakeVision(), extractPdfText },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it('fails fast on the first OCR error and stops scheduling pages', async () => {
    const renderer = fakeRenderer();
    const vision = jest.fn<ReturnType<VisionCaller>, Parameters<VisionCaller>>(async () => {
      throw new OcrError('vision_failed', 'Vision OCR request failed with status 500');
    });
    const { params, extractPdfText } = pdfParams(Array(8).fill(''), {
      config: makeConfig({ concurrency: 1 }),
    });
    await expect(
      extractDocumentText(params, {
        callVision: vision,
        renderPages: renderer.render,
        extractPdfText,
      }),
    ).rejects.toMatchObject({ code: 'vision_failed' });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(renderer.closed()).toBe(true);
  });

  it('reports the usage of completed calls on a failure (`partial`)', async () => {
    let calls = 0;
    const vision: VisionCaller = async () => {
      calls++;
      if (calls === 3) {
        throw new OcrError('vision_failed', 'Vision OCR request failed with status 500');
      }
      return { text: 'متن', promptTokens: 1000, completionTokens: 400, estimated: false };
    };
    const { params, extractPdfText } = pdfParams(['', '', '', '', ''], {
      config: makeConfig({ concurrency: 1 }),
    });
    const error = await extractDocumentText(params, {
      callVision: vision,
      renderPages: fakeRenderer().render,
      extractPdfText,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OcrError);
    const { partial } = error as OcrError;
    expect(partial).toMatchObject({ ocrPages: 2, localPages: 0, pages: 5 });
    expect(partial?.usage).toEqual([
      expect.objectContaining({ calls: 2, promptTokens: 2000, completionTokens: 800 }),
    ]);
  });

  it('reports completed calls when the caller aborts mid-way', async () => {
    const controller = new AbortController();
    let calls = 0;
    const vision: VisionCaller = (request) => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          text: 'متن',
          promptTokens: 900,
          completionTokens: 100,
          estimated: false,
        });
      }
      controller.abort();
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        if (request.signal?.aborted) {
          reject(new Error('cancelled'));
        }
      });
    };
    const { params, extractPdfText } = pdfParams(['', '', ''], {
      signal: controller.signal,
      config: makeConfig({ concurrency: 1 }),
    });
    const error = (await extractDocumentText(params, {
      callVision: vision,
      renderPages: fakeRenderer().render,
      extractPdfText,
    }).catch((caught: unknown) => caught)) as OcrError;

    expect(error.code).toBe('aborted');
    expect(error.partial?.usage).toEqual([
      expect.objectContaining({ calls: 1, promptTokens: 900, completionTokens: 100 }),
    ]);
  });

  it('counts local pages finished before a Tesseract failure', async () => {
    let runs = 0;
    const runTesseract: TesseractRunner = async () => {
      runs++;
      if (runs === 2) {
        throw new Error('crashed');
      }
      return { text: 'سلام' };
    };
    const { params, extractPdfText } = pdfParams(['', '', ''], {
      route: 'local',
      config: makeConfig({ concurrency: 1 }),
    });
    const error = (await extractDocumentText(params, {
      callVision: fakeVision(),
      runTesseract,
      renderPages: fakeRenderer().render,
      extractPdfText,
    }).catch((caught: unknown) => caught)) as OcrError;

    expect(error).toMatchObject({ name: 'OcrError', code: 'tesseract_failed' });
    expect(error.partial).toMatchObject({ localPages: 1, ocrPages: 1, usage: [] });
  });

  it('requires the route to be configured', async () => {
    const { params, extractPdfText } = pdfParams([''], {
      config: makeConfig({ private: undefined }),
      route: 'private',
    });
    await expect(
      extractDocumentText(params, { callVision: fakeVision(), extractPdfText }),
    ).rejects.toMatchObject({ code: 'route_not_configured' });
  });
});

describe('extractDocumentText — images and guards', () => {
  const imageParams = {
    buffer: Buffer.from('jpeg-bytes'),
    mimetype: 'image/jpeg',
    filename: 'scan.jpg',
    route: 'public' as const,
    config: makeConfig(),
  };

  it('OCRs an image as a single page with the vision model', async () => {
    const vision = fakeVision();
    const result = await extractDocumentText(imageParams, { callVision: vision });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(vision.mock.calls[0][0]).toMatchObject({ mimetype: 'image/jpeg' });
    expect(result).toMatchObject({ pages: 1, ocrPages: 1, engine: 'vision', truncated: false });
    expect(result.text).toBe('متن خوانده‌شده از jpeg-bytes');
  });

  it('OCRs an image locally on the local route', async () => {
    const runTesseract: TesseractRunner = async () => ({ text: 'سلام  دنيا\n' });
    const result = await extractDocumentText(
      { ...imageParams, route: 'local' },
      { callVision: fakeVision(), runTesseract },
    );
    expect(result).toMatchObject({ text: 'سلام دنیا', engine: 'tesseract', localPages: 1 });
  });

  it('rejects image types the engine cannot read', async () => {
    await expect(
      extractDocumentText(
        { ...imageParams, mimetype: 'image/svg+xml' },
        { callVision: fakeVision() },
      ),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('rejects non-PDF documents', async () => {
    await expect(
      extractDocumentText(
        { ...imageParams, mimetype: 'text/plain', filename: 'a.txt' },
        { callVision: fakeVision() },
      ),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('refuses to run when disabled', async () => {
    await expect(
      extractDocumentText(
        { ...imageParams, config: makeConfig({ enabled: false }) },
        { callVision: fakeVision() },
      ),
    ).rejects.toBeInstanceOf(OcrError);
  });
});
