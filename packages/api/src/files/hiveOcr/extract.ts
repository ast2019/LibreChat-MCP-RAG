import type {
  OcrRoute,
  OcrUsage,
  VisionCaller,
  PageRenderer,
  TesseractRunner,
  DocumentOcrConfig,
  DocumentTextResult,
} from './types';
import { createPdfPageRenderer, extractPdfPageTexts } from './pdf';
import { createTesseractRunner } from './tesseract';
import { normalizePersianText } from './normalize';
import { assessExtractedText } from './quality';
import { OcrError } from './types';

export interface ExtractDocumentTextParams {
  buffer: Buffer;
  mimetype: string;
  filename: string;
  route: OcrRoute;
  config: DocumentOcrConfig;
  signal?: AbortSignal;
  /** Called as pages finish; `total` is the number of pages processed (≤ maxPages). */
  onProgress?: (done: number, total: number) => void;
}

export interface ExtractDocumentTextDeps {
  callVision: VisionCaller;
  /** Defaults to the Tesseract CLI configured by `config.local`. */
  runTesseract?: TesseractRunner;
  /** Defaults to pdfjs + @napi-rs/canvas at `config.dpi` / `config.maxSide`. */
  renderPages?: PageRenderer;
  /** Raw text layer per page; defaults to pdfjs. */
  extractPdfText?: (buffer: Buffer) => Promise<string[]>;
}

const VISION_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TESSERACT_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
]);

/** Separator placed before page N (N ≥ 2) in `DocumentTextResult.text`. */
export function pageSeparator(pageNumber: number): string {
  return `\n\n--- صفحهٔ ${pageNumber} ---\n\n`;
}

const SEPARATOR_PATTERN = /\n*--- صفحهٔ \d+ ---\n*/g;

/** Whether an extraction found any text, ignoring the page separators `joinPages` adds. */
export function hasExtractedText(text: string): boolean {
  return text.replace(SEPARATOR_PATTERN, '').trim() !== '';
}

export function joinPages(pages: readonly string[]): string {
  return pages.reduce(
    (text, page, index) => (index === 0 ? page : text + pageSeparator(index + 1) + page),
    '',
  );
}

function normalizeMimetype(mimetype: string): string {
  const base = mimetype.split(';')[0].trim().toLowerCase();
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function isPdf(mimetype: string, filename: string): boolean {
  if (mimetype === 'application/pdf') {
    return true;
  }
  return mimetype === 'application/octet-stream' && /\.pdf$/i.test(filename);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new OcrError('aborted', 'OCR was cancelled');
  }
}

type PageOcr = (image: Buffer, mimetype: string, signal: AbortSignal) => Promise<string>;

interface OcrEngine {
  kind: 'vision' | 'tesseract';
  ocr: PageOcr;
  accepts: Set<string>;
}

interface OcrTally {
  usage: Map<string, OcrUsage>;
  localPages: number;
}

function createEngine(
  params: ExtractDocumentTextParams,
  deps: ExtractDocumentTextDeps,
  tally: OcrTally,
  dpi: number | undefined,
): OcrEngine {
  const { route, config } = params;
  if (route === 'local') {
    const local = config.local;
    if (!deps.runTesseract && !local) {
      throw new OcrError('route_not_configured', 'documentOcr.local is not configured');
    }
    const run =
      deps.runTesseract ??
      createTesseractRunner({
        binary: local?.binary,
        languages: local?.languages ?? 'fas+eng',
        timeoutMs: config.timeoutMs,
        dpi,
      });
    return {
      kind: 'tesseract',
      accepts: TESSERACT_IMAGE_TYPES,
      ocr: async (image, _mimetype, signal) => {
        const { text } = await run({ image, signal });
        tally.localPages++;
        return text;
      },
    };
  }

  const target = config[route];
  if (!target) {
    throw new OcrError('route_not_configured', `documentOcr.${route} is not configured`);
  }
  return {
    kind: 'vision',
    accepts: VISION_IMAGE_TYPES,
    ocr: async (image, mimetype, signal) => {
      const response = await deps.callVision({
        endpoint: target.endpoint,
        model: target.model,
        image,
        mimetype,
        signal,
      });
      const key = `${target.endpoint}\u0000${target.model}`;
      const entry = tally.usage.get(key) ?? {
        endpoint: target.endpoint,
        model: target.model,
        promptTokens: 0,
        completionTokens: 0,
        calls: 0,
        estimated: false,
      };
      entry.promptTokens += response.promptTokens;
      entry.completionTokens += response.completionTokens;
      entry.calls++;
      entry.estimated = entry.estimated || response.estimated;
      tally.usage.set(key, entry);
      return response.text;
    },
  };
}

/** Runs `task` over `items` with at most `limit` in flight; the first failure aborts the rest. */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  controller: AbortController,
  task: (item: T, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (next < items.length && failure === undefined && !controller.signal.aborted) {
      const item = items[next++];
      try {
        await task(item, controller.signal);
      } catch (error) {
        if (failure === undefined) {
          failure = error;
          controller.abort();
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== undefined) {
    throw failure;
  }
}

function linkSignal(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller;
}

/**
 * Extracts text from a PDF or image. PDF pages with a usable text layer are kept (free); empty or
 * garbled pages are rendered and OCR'd through the route (`public`/`private` → vision model,
 * `local` → Tesseract). Images are OCR'd as one page. All text is Persian-normalized.
 *
 * @throws {OcrError} `disabled`, `unsupported_type`, `route_not_configured`, `aborted`, and the
 * engine failures (`vision_failed`, `tesseract_missing`, `canvas_unavailable`, …). Once OCR has
 * started the error carries `partial`: the usage of the calls that completed.
 */
export async function extractDocumentText(
  params: ExtractDocumentTextParams,
  deps: ExtractDocumentTextDeps,
): Promise<DocumentTextResult> {
  const { buffer, config, signal, onProgress } = params;
  if (!config.enabled) {
    throw new OcrError('disabled', 'Document OCR is disabled');
  }
  throwIfAborted(signal);

  const mimetype = normalizeMimetype(params.mimetype);
  const tally: OcrTally = { usage: new Map(), localPages: 0 };
  const finish = (
    pageTexts: string[],
    pages: number,
    ocrPages: number,
    kind: OcrEngine['kind'] | undefined,
    truncated: boolean,
  ): DocumentTextResult => {
    let engine: DocumentTextResult['engine'] = 'text';
    if (kind && ocrPages > 0) {
      engine = ocrPages === pageTexts.length ? kind : 'mixed';
    }
    return {
      text: joinPages(pageTexts),
      pages,
      ocrPages,
      engine,
      usage: Array.from(tally.usage.values()),
      localPages: tally.localPages,
      truncated,
    };
  };

  if (mimetype.startsWith('image/')) {
    const engine = createEngine(params, deps, tally, undefined);
    if (!engine.accepts.has(mimetype)) {
      throw new OcrError('unsupported_type', `Images of type ${mimetype} cannot be OCR'd`);
    }
    const controller = linkSignal(signal);
    let text = '';
    try {
      text = normalizePersianText(await engine.ocr(buffer, mimetype, controller.signal));
      throwIfAborted(signal);
    } catch (error) {
      throw withPartial(error, signal, engine.kind, finish([text], 1, 0, engine.kind, false));
    }
    onProgress?.(1, 1);
    return finish([text], 1, 1, engine.kind, false);
  }

  if (!isPdf(mimetype, params.filename)) {
    throw new OcrError('unsupported_type', `Files of type ${mimetype} are not supported`);
  }

  const rawPages = await (deps.extractPdfText ?? extractPdfPageTexts)(buffer);
  throwIfAborted(signal);
  const limit = Math.min(rawPages.length, config.maxPages);
  const truncated = rawPages.length > limit;

  const pageTexts: string[] = [];
  const scanned: number[] = [];
  for (let i = 0; i < limit; i++) {
    const text = normalizePersianText(rawPages[i] ?? '');
    pageTexts.push(text);
    if (!assessExtractedText(text).usable) {
      scanned.push(i);
    }
  }

  let done = limit - scanned.length;
  onProgress?.(done, limit);
  if (scanned.length === 0) {
    return finish(pageTexts, rawPages.length, 0, undefined, truncated);
  }

  const engine = createEngine(params, deps, tally, config.dpi);
  const render =
    deps.renderPages ?? createPdfPageRenderer({ dpi: config.dpi, maxSide: config.maxSide });
  const session = await render(buffer);
  const controller = linkSignal(signal);
  let completed = 0;
  try {
    await runPool(scanned, config.concurrency, controller, async (index, poolSignal) => {
      const image = await session.renderPage(index + 1);
      throwIfAborted(poolSignal);
      pageTexts[index] = normalizePersianText(await engine.ocr(image, 'image/png', poolSignal));
      completed++;
      done++;
      onProgress?.(done, limit);
    });
    throwIfAborted(signal);
  } catch (error) {
    throw withPartial(
      error,
      signal,
      engine.kind,
      finish(pageTexts, rawPages.length, completed, engine.kind, truncated),
    );
  } finally {
    await session.close();
  }
  return finish(pageTexts, rawPages.length, scanned.length, engine.kind, truncated);
}

/**
 * The failure to report once OCR has started, carrying what finished before it (`partial`) so the
 * caller bills exactly the completed calls. A caller abort always reports `aborted`.
 */
function withPartial(
  error: unknown,
  signal: AbortSignal | undefined,
  kind: OcrEngine['kind'],
  partial: DocumentTextResult,
): OcrError {
  let failure: OcrError;
  if (signal?.aborted) {
    failure = error instanceof OcrError && error.code === 'aborted' ? error : abortedError(error);
  } else if (error instanceof OcrError) {
    failure = error;
  } else {
    const code = kind === 'tesseract' ? 'tesseract_failed' : 'vision_failed';
    failure = new OcrError(code, 'OCR failed', { cause: error });
  }
  failure.partial = partial;
  return failure;
}

function abortedError(cause: unknown): OcrError {
  return new OcrError('aborted', 'OCR was cancelled', { cause });
}
