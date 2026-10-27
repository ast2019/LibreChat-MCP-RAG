import type { TDocumentOcrConfig } from 'librechat-data-provider';

/** Where scanned pages are OCR'd: `public`/`private` call a vision model, `local` runs Tesseract. */
export type OcrRoute = 'public' | 'private' | 'local';

/** Parsed `documentOcr` block (defaults applied); see `resolveDocumentOcrConfig`. */
export type DocumentOcrConfig = TDocumentOcrConfig;

/** Token usage of vision OCR calls, aggregated per endpoint + model. */
export interface OcrUsage {
  endpoint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Number of vision calls aggregated into this entry. */
  calls: number;
  /** True when at least one call returned no usage and tokens were estimated. */
  estimated: boolean;
}

export interface DocumentTextResult {
  /** Final normalized text; pages joined by `"\n\n--- صفحهٔ N ---\n\n"` (N = the next page). */
  text: string;
  /** Total pages in the document (1 for images), including pages beyond `maxPages`. */
  pages: number;
  /** Pages that needed OCR. */
  ocrPages: number;
  engine: 'text' | 'vision' | 'tesseract' | 'mixed';
  usage: OcrUsage[];
  /** Pages OCR'd locally (Tesseract). */
  localPages: number;
  /** True when the document had more pages than `maxPages`. */
  truncated: boolean;
}

export interface VisionRequest {
  endpoint: string;
  model: string;
  image: Buffer;
  /** MIME type of `image`, e.g. `image/png`. */
  mimetype: string;
  signal?: AbortSignal;
}

export interface VisionResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** True when the provider returned no usage and tokens were estimated. */
  estimated: boolean;
}

export type VisionCaller = (request: VisionRequest) => Promise<VisionResponse>;

export interface TesseractRequest {
  image: Buffer;
  signal?: AbortSignal;
}

export type TesseractRunner = (request: TesseractRequest) => Promise<{ text: string }>;

/** An opened PDF that renders pages (1-based) to PNG. */
export interface RenderSession {
  renderPage: (pageNumber: number) => Promise<Buffer>;
  close: () => Promise<void>;
}

export type PageRenderer = (pdf: Buffer) => Promise<RenderSession>;

export type OcrErrorCode =
  | 'disabled'
  | 'unsupported_type'
  | 'route_not_configured'
  | 'endpoint_not_found'
  | 'vision_failed'
  | 'tesseract_missing'
  | 'tesseract_failed'
  | 'canvas_unavailable'
  | 'pdf_invalid'
  | 'render_failed'
  | 'aborted'
  | 'timeout'
  /** The user's balance does not cover the estimated OCR cost. */
  | 'insufficient_balance'
  /** A private/local conversation asked for a destination that would retain the file. */
  | 'private_destination';

/** Operational OCR failure with a stable code; messages never carry provider payloads. */
export class OcrError extends Error {
  readonly code: OcrErrorCode;
  /**
   * What was extracted before the failure: completed vision calls (`usage`) and Tesseract pages
   * (`localPages`). Billing charges exactly this; pages that did not finish are free.
   */
  partial?: DocumentTextResult;

  constructor(code: OcrErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OcrError';
    this.code = code;
  }

  /** Read by the upload route to pick the response status. */
  get userErrorStatusCode(): number {
    return getOcrErrorStatus(this.code);
  }
}

/** Localization key (en + fa) the client shows for an OCR failure; sent as the upload error. */
export function getOcrErrorMessageKey(code: OcrErrorCode): string {
  return `com_error_ocr_${code}`;
}

/** HTTP status for an OCR failure surfaced at the upload boundary. */
export function getOcrErrorStatus(code: OcrErrorCode): number {
  switch (code) {
    case 'insufficient_balance':
      return 402;
    case 'unsupported_type':
    case 'pdf_invalid':
      return 422;
    case 'private_destination':
      return 403;
    case 'timeout':
      return 504;
    case 'aborted':
      return 499;
    default:
      return 500;
  }
}
