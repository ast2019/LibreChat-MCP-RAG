import path from 'path';
import type {
  TextItem,
  PDFDocumentProxy,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';
import type { PageRenderer, RenderSession } from './types';
import { OcrError } from './types';

export type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type PdfjsLoader = () => Promise<PdfjsModule>;
export type CanvasModule = typeof import('@napi-rs/canvas');
export type CanvasLoader = () => Promise<CanvasModule>;

/** Imported lazily: pdfjs is ESM-only and heavy, and only PDF uploads need it. */
export const loadPdfjs: PdfjsLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs');

/** Imported lazily so a missing native binary fails the render with a clear error, not the app. */
export const loadCanvas: CanvasLoader = () => import('@napi-rs/canvas');

let assetUrls: { cMapUrl: string; standardFontDataUrl: string; wasmUrl: string } | undefined;

/** Local pdfjs asset directories (CJK/CID CMaps, standard fonts, JPX/JBIG2 decoders). */
function getAssetUrls(): { cMapUrl: string; standardFontDataUrl: string; wasmUrl: string } {
  if (!assetUrls) {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    assetUrls = {
      cMapUrl: path.join(root, 'cmaps') + path.sep,
      standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
      wasmUrl: path.join(root, 'wasm') + path.sep,
    };
  }
  return assetUrls;
}

/** Opens a PDF from memory with Node-safe options; unreadable files throw `pdf_invalid`. */
export async function openPdf(
  buffer: Buffer,
  loader: PdfjsLoader = loadPdfjs,
): Promise<PDFDocumentProxy> {
  const { getDocument } = await loader();
  try {
    return await getDocument({
      data: new Uint8Array(buffer),
      ...getAssetUrls(),
      cMapPacked: true,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const reason = name === 'PasswordException' ? 'is password protected' : 'could not be read';
    throw new OcrError('pdf_invalid', `The PDF ${reason}`);
  }
}

/**
 * Joins pdfjs text items the way pdf.js's own find controller does: items are concatenated
 * (pdfjs inserts its own spaces) and `hasEOL` becomes a newline, so lines stay separate.
 */
export function pageTextFromItems(items: ReadonlyArray<TextItem | TextMarkedContent>): string {
  let text = '';
  for (const item of items) {
    if (!('str' in item)) {
      continue;
    }
    text += item.str;
    if (item.hasEOL) {
      text += '\n';
    }
  }
  return text;
}

/**
 * Raw per-page text layer of a PDF. Unicode normalization is disabled so Persian positional
 * forms survive for `normalizePersianText`, which needs them to detect reversed lines.
 */
export async function extractPdfPageTexts(
  buffer: Buffer,
  loader: PdfjsLoader = loadPdfjs,
): Promise<string[]> {
  const pdf = await openPdf(buffer, loader);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent({ disableNormalization: true });
      pages.push(pageTextFromItems(content.items));
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

export interface PdfPageRendererOptions {
  dpi: number;
  /** Longest side in pixels; the effective DPI is lowered to fit. */
  maxSide: number;
  loadPdfjs?: PdfjsLoader;
  loadCanvas?: CanvasLoader;
}

/** Scale (pdf points → pixels) for `dpi`, capped so the longest side fits `maxSide`. */
export function computeRenderScale(
  width: number,
  height: number,
  dpi: number,
  maxSide: number,
): number {
  const scale = dpi / 72;
  const longest = Math.max(width, height) * scale;
  return longest > maxSide ? scale * (maxSide / longest) : scale;
}

async function requireCanvas(loader: CanvasLoader): Promise<CanvasModule> {
  try {
    const canvas = await loader();
    if (typeof canvas.createCanvas !== 'function') {
      throw new Error('createCanvas missing');
    }
    return canvas;
  } catch {
    throw new OcrError(
      'canvas_unavailable',
      'PDF page rendering needs the "@napi-rs/canvas" native module for this platform; install it to OCR scanned PDFs',
    );
  }
}

/** Renders PDF pages to white-background PNGs with pdfjs + @napi-rs/canvas. */
export function createPdfPageRenderer(options: PdfPageRendererOptions): PageRenderer {
  const pdfjsLoader = options.loadPdfjs ?? loadPdfjs;
  const canvasLoader = options.loadCanvas ?? loadCanvas;

  return async (buffer: Buffer): Promise<RenderSession> => {
    const canvasModule = await requireCanvas(canvasLoader);
    const pdf = await openPdf(buffer, pdfjsLoader);

    const renderPage = async (pageNumber: number): Promise<Buffer> => {
      const page = await pdf.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = computeRenderScale(base.width, base.height, options.dpi, options.maxSide);
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const canvas = canvasModule.createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        /** pdfjs types its targets as DOM canvases; @napi-rs/canvas implements the same API. */
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        return await canvas.encode('png');
      } catch (error) {
        if (error instanceof OcrError) {
          throw error;
        }
        throw new OcrError('render_failed', `Page ${pageNumber} of the PDF could not be rendered`);
      } finally {
        page.cleanup();
      }
    };

    return {
      renderPage,
      close: () => pdf.destroy(),
    };
  };
}
