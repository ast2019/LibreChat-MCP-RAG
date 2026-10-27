import { logger } from '@librechat/data-schemas';
import type { IMongoFile } from '@librechat/data-schemas';
import type { TFileOcr } from 'librechat-data-provider';
import type { DocumentTextConverter } from '~/files/encode/document';
import type { DocumentOcrService } from './service';
import type { AcceptsFiles } from './upload';
import type { ServerRequest } from '~/types';
import { strictestOcrRoute, resolveOcrRoute } from './route';
import { conversationReadsPdfs } from './upload';
import { OcrError } from './types';

export interface DocumentTextConverterDeps {
  service: DocumentOcrService;
  /** Stores the extracted text on the file record so later turns reuse it. */
  saveFileText: (params: { file_id: string; text: string; ocr: TFileOcr }) => Promise<unknown>;
  acceptsFiles?: AcceptsFiles;
}

interface TurnBody {
  endpoint?: unknown;
  spec?: unknown;
  conversationId?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The encode-time half of "PDFs for models without file input": a PDF uploaded while the
 * conversation used a file-reading model, then sent to one that cannot read files (or to a local
 * endpoint), is extracted once through `documentOcr`, billed, and its text persisted on the file.
 * The route comes from the turn itself (its endpoint and spec), so no conversation is read.
 */
export function createDocumentTextConverter(
  deps: DocumentTextConverterDeps,
): DocumentTextConverter {
  const pending = new Map<string, Promise<string>>();

  async function convert(req: ServerRequest, file: IMongoFile, pdf: Buffer, endpoint?: string) {
    const config = deps.service.getConfig(req.config);
    const body = (req.body ?? {}) as TurnBody;
    const context = {
      specs: req.config?.modelSpecs?.list,
      localEndpoints: config.localEndpoints,
      privateEndpoints: config.privateEndpoints,
    };
    const route = strictestOcrRoute(
      resolveOcrRoute({ endpoint: asString(body.endpoint), spec: asString(body.spec) }, context),
      resolveOcrRoute({ endpoint }, context),
    );
    let outcome;
    try {
      outcome = await deps.service.extract({
        req,
        buffer: pdf,
        mimetype: 'application/pdf',
        filename: file.filename,
        route,
        conversationId: asString(body.conversationId),
      });
    } catch (error) {
      /** The chat error renderer already explains a short balance; hand it chat's own error. */
      if (error instanceof OcrError && error.code === 'insufficient_balance' && error.cause) {
        throw error.cause;
      }
      throw error;
    }
    file.text = outcome.text;
    (file as IMongoFile & { ocr?: TFileOcr }).ocr = outcome.ocr;
    try {
      await deps.saveFileText({ file_id: file.file_id, text: outcome.text, ocr: outcome.ocr });
    } catch (error) {
      logger.error('[documentOcr] Failed to store extracted text on the file', error);
    }
    return outcome.text;
  }

  return {
    needsText: (req, { endpoint, model }) => {
      const config = deps.service.getConfig(req.config);
      if (!config.enabled) {
        return false;
      }
      return !conversationReadsPdfs({ endpoint, model }, config, deps.acceptsFiles);
    },
    getText: (req, file, pdf, { endpoint }) => {
      /** Encoders running at once for one file (primary agent and a handoff) share one
       * extraction, so it is billed once. */
      const key = file.file_id;
      let text = pending.get(key);
      if (!text) {
        text = convert(req, file, pdf, endpoint).finally(() => pending.delete(key));
        pending.set(key, text);
      }
      return text;
    },
  };
}
