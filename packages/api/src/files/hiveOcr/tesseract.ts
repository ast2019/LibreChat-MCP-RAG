import { execFile } from 'child_process';
import type { TesseractRequest, TesseractRunner } from './types';
import { OcrError } from './types';

export interface TesseractRunnerOptions {
  /** Executable name or path (default `tesseract`). */
  binary?: string;
  /** `-l` value, e.g. `fas+eng`; the traineddata files must be installed. */
  languages: string;
  timeoutMs: number;
  /** Resolution of the input image; PNGs rendered from PDFs carry no DPI metadata. */
  dpi?: number;
  /** Threads per run (`OMP_THREAD_LIMIT`, default 1) so concurrency maps to cores. */
  threads?: number;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Runs the Tesseract CLI with the image on stdin and the text on stdout. A missing binary
 * throws `tesseract_missing`; missing language data or other failures throw `tesseract_failed`.
 */
export function createTesseractRunner(options: TesseractRunnerOptions): TesseractRunner {
  const binary = options.binary ?? 'tesseract';
  const args = ['stdin', 'stdout', '-l', options.languages, '--psm', '3'];
  if (options.dpi) {
    args.push('--dpi', String(options.dpi));
  }
  const env = { ...process.env, OMP_THREAD_LIMIT: String(options.threads ?? 1) };

  return (request: TesseractRequest): Promise<{ text: string }> =>
    new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(new OcrError('aborted', 'OCR was cancelled'));
        return;
      }
      const child = execFile(
        binary,
        args,
        {
          env,
          timeout: options.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: 'utf8',
          signal: request.signal,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ text: stdout });
            return;
          }
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            reject(
              new OcrError(
                'tesseract_missing',
                `Tesseract binary "${binary}" was not found; install tesseract-ocr with the "${options.languages}" language data to use local OCR`,
              ),
            );
            return;
          }
          if (request.signal?.aborted || code === 'ABORT_ERR') {
            reject(new OcrError('aborted', 'OCR was cancelled'));
            return;
          }
          if ((error as { killed?: boolean }).killed) {
            reject(new OcrError('timeout', `Tesseract timed out after ${options.timeoutMs} ms`));
            return;
          }
          const missingLanguage = /Failed loading language|Error opening data file/i.test(stderr);
          reject(
            new OcrError(
              'tesseract_failed',
              missingLanguage
                ? `Tesseract language data "${options.languages}" is not installed`
                : 'Tesseract could not read the image',
            ),
          );
        },
      );
      child.stdin?.on('error', () => {
        /* EPIPE when the process exits early; the exit callback reports the failure. */
      });
      child.stdin?.end(request.image);
    });
}
