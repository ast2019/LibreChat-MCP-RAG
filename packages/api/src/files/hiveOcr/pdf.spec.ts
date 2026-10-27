import type { CanvasModule, PdfjsLoader, PdfjsModule } from './pdf';
import {
  openPdf,
  pageTextFromItems,
  computeRenderScale,
  extractPdfPageTexts,
  createPdfPageRenderer,
} from './pdf';
import { resolveDocumentOcrConfig } from './config';
import { extractDocumentText } from './extract';
import { buildPdf } from './fixtures.helper';

/**
 * pdfjs ships ESM with `import.meta`, which Jest's CJS runtime cannot evaluate; Node's own
 * `require` loads it natively (require(esm), Node ≥ 22.12), so these tests run real pdfjs.
 */
const nativeRequire = process.getBuiltinModule('module').createRequire(__filename);
const loadRealPdfjs: PdfjsLoader = async () =>
  nativeRequire('pdfjs-dist/legacy/build/pdf.mjs') as PdfjsModule;

let canvasModule: CanvasModule | undefined;
let canvasError = '';
try {
  canvasModule = nativeRequire('@napi-rs/canvas') as CanvasModule;
} catch (error) {
  canvasError = error instanceof Error ? error.message : String(error);
}
const describeWithCanvas = canvasModule ? describe : describe.skip;
if (!canvasModule) {
  console.warn(`Skipping PDF render tests: @napi-rs/canvas failed to load (${canvasError})`);
}

const LINE_1 = 'Hello OCR world, this page has a real text layer.';
const LINE_2 = 'Second line of the first page.';

function readPngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('pageTextFromItems', () => {
  it('concatenates items and turns hasEOL into newlines', () => {
    const item = (str: string, hasEOL: boolean) => ({
      str,
      hasEOL,
      dir: 'ltr',
      width: 0,
      height: 0,
      transform: [],
      fontName: 'f',
    });
    expect(
      pageTextFromItems([
        item('سلام', false),
        item(' ', false),
        item('دنیا', true),
        item('خط دوم', false),
      ]),
    ).toBe('سلام دنیا\nخط دوم');
  });
});

describe('computeRenderScale', () => {
  it('renders at the configured DPI and caps the longest side', () => {
    expect(computeRenderScale(612, 792, 72, 2000)).toBe(1);
    expect(computeRenderScale(612, 792, 144, 4000)).toBe(2);
    // A4 letter at 200 DPI is 2200 px tall → capped to 2000
    expect(792 * computeRenderScale(612, 792, 200, 2000)).toBeCloseTo(2000, 6);
  });
});

describe('pdfjs text layer (real pdfjs)', () => {
  const pdf = buildPdf([[LINE_1, LINE_2], []]);

  it('extracts one string per page with line breaks', async () => {
    const pages = await extractPdfPageTexts(pdf, loadRealPdfjs);
    expect(pages).toHaveLength(2);
    expect(pages[0].replace(/[ ]+/g, ' ').trim()).toBe(`${LINE_1}\n${LINE_2}`);
    expect(pages[1].trim()).toBe('');
  });

  it('rejects a corrupt file with `pdf_invalid`', async () => {
    await expect(openPdf(Buffer.from('not a pdf'), loadRealPdfjs)).rejects.toMatchObject({
      code: 'pdf_invalid',
    });
  });
});

describeWithCanvas('createPdfPageRenderer (real pdfjs + @napi-rs/canvas)', () => {
  const pdf = buildPdf([[LINE_1], []]);

  it('renders a page to a PNG within maxSide', async () => {
    const render = createPdfPageRenderer({
      dpi: 200,
      maxSide: 1000,
      loadPdfjs: loadRealPdfjs,
      loadCanvas: async () => canvasModule as CanvasModule,
    });
    const session = await render(pdf);
    try {
      const png = await session.renderPage(1);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      const { width, height } = readPngSize(png);
      expect(height).toBe(1000);
      expect(width).toBe(Math.round(612 * (1000 / 792)));

      const canvas = (canvasModule as CanvasModule).createCanvas(width, height);
      const context = canvas.getContext('2d');
      context.drawImage(await (canvasModule as CanvasModule).loadImage(png), 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 128) {
          dark++;
        }
      }
      /** White background with the text drawn in black */
      expect(pixels[0]).toBe(255);
      expect(dark).toBeGreaterThan(100);
    } finally {
      await session.close();
    }
  });

  it('OCRs only the blank page end-to-end with real rendering', async () => {
    const callVision = jest.fn(async () => ({
      text: 'متن صفحهٔ اسکن‌شده',
      promptTokens: 1100,
      completionTokens: 20,
      estimated: false,
    }));
    const result = await extractDocumentText(
      {
        buffer: buildPdf([[LINE_1, LINE_2], []]),
        mimetype: 'application/pdf',
        filename: 'mixed.pdf',
        route: 'public',
        config: resolveDocumentOcrConfig({
          enabled: true,
          dpi: 72,
          public: { endpoint: 'OpenRouter', model: 'google/gemini-3.8-flash' },
        }),
      },
      {
        callVision,
        extractPdfText: (buffer) => extractPdfPageTexts(buffer, loadRealPdfjs),
        renderPages: createPdfPageRenderer({
          dpi: 72,
          maxSide: 2000,
          loadPdfjs: loadRealPdfjs,
          loadCanvas: async () => canvasModule as CanvasModule,
        }),
      },
    );
    expect(callVision).toHaveBeenCalledTimes(1);
    const [[request]] = callVision.mock.calls as unknown as [[{ image: Buffer; mimetype: string }]];
    expect(request.mimetype).toBe('image/png');
    expect(readPngSize(request.image)).toEqual({ width: 612, height: 792 });
    expect(result).toMatchObject({ engine: 'mixed', pages: 2, ocrPages: 1 });
    expect(result.text).toBe(`${LINE_1}\n${LINE_2}\n\n--- صفحهٔ 2 ---\n\nمتن صفحهٔ اسکن‌شده`);
  });
});

describe('createPdfPageRenderer without @napi-rs/canvas', () => {
  const pdf = buildPdf([[LINE_1], []]);

  it('fails with `canvas_unavailable` when the native module cannot load', async () => {
    const render = createPdfPageRenderer({
      dpi: 200,
      maxSide: 2000,
      loadPdfjs: loadRealPdfjs,
      loadCanvas: async () => {
        throw new Error('Cannot find module @napi-rs/canvas-linux-x64-musl');
      },
    });
    await expect(render(pdf)).rejects.toMatchObject({
      code: 'canvas_unavailable',
      message: expect.stringContaining('@napi-rs/canvas'),
    });
  });
});
