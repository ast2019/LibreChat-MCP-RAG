import path from 'path';
import * as fs from 'fs';
import {
  EToolResources,
  isAssistantsEndpoint,
  normalizeEndpointName,
} from 'librechat-data-provider';
import type { TFileOcr } from 'librechat-data-provider';
import type { Response } from 'express';
import type { DocumentOcrService, UploadConversationContext } from './service';
import type { DocumentOcrConfig, OcrRoute } from './types';
import type { ServerRequest } from '~/types';
import { modelAcceptsFiles } from '~/modelSpecs/catalogue';
import { isDocumentOcrType } from './runtime';
import { hasExtractedText } from './extract';
import { OcrError } from './types';

/** The upload request fields the OCR plan reads (multipart values arrive as strings). */
export interface OcrUploadMetadata {
  endpoint?: string;
  /** The endpoint validation used (an agent's provider for agent uploads). */
  effectiveEndpoint?: string;
  conversationId?: string;
  spec?: string;
  model?: string;
  agent_id?: string;
  tool_resource?: string | null;
}

export interface OcrUploadFile {
  path: string;
  mimetype: string;
  originalname: string;
  size?: number;
}

export interface DocumentOcrUploadPlan {
  route: OcrRoute;
  /** The model this conversation talks to cannot read PDFs: store the text instead. */
  forceText: boolean;
}

export type AcceptsFiles = (model: string) => boolean | undefined;

function isPdfUpload(file: Pick<OcrUploadFile, 'mimetype' | 'originalname'>): boolean {
  return isDocumentOcrType(file.mimetype, file.originalname) && !file.mimetype.startsWith('image/');
}

function isListed(list: readonly string[], endpoint: string | undefined): boolean {
  if (!endpoint) {
    return false;
  }
  const name = normalizeEndpointName(endpoint);
  return list.some((entry) => normalizeEndpointName(entry) === name);
}

/**
 * Whether the model a conversation talks to reads PDFs natively. Local endpoints (Ollama) never
 * do; otherwise the catalogue decides, and an unknown model is assumed to (its PDFs go out with
 * the `native` engine pinned, so nothing is OCR'd behind our back).
 */
export function conversationReadsPdfs(
  context: Pick<UploadConversationContext, 'endpoint' | 'model'>,
  config: Pick<DocumentOcrConfig, 'localEndpoints'>,
  acceptsFiles: AcceptsFiles = modelAcceptsFiles,
): boolean {
  if (isListed(config.localEndpoints, context.endpoint)) {
    return false;
  }
  if (!context.model) {
    return true;
  }
  return acceptsFiles(context.model) !== false;
}

/**
 * How `documentOcr` treats one upload, decided before processing: the conversation's OCR route,
 * and whether a PDF must become text because the conversation's model cannot read it. Refuses a
 * file-search upload in a private or local conversation, whose embeddings would leave the
 * deployment's zero-retention boundary. `null` when `documentOcr` is off or the upload is not a
 * conversation file it handles.
 */
export async function planDocumentOcrUpload({
  req,
  metadata,
  file,
  service,
  agentModel,
  acceptsFiles,
}: {
  req: ServerRequest;
  metadata: OcrUploadMetadata;
  file: Pick<OcrUploadFile, 'mimetype' | 'originalname'>;
  service: DocumentOcrService;
  /** The model of the agent the upload targets, when an agent record backs it. */
  agentModel?: string;
  acceptsFiles?: AcceptsFiles;
}): Promise<DocumentOcrUploadPlan | null> {
  const config = service.getConfig(req.config);
  if (!config.enabled || isAssistantsEndpoint(metadata.endpoint)) {
    return null;
  }
  const requestedEndpoint = metadata.effectiveEndpoint ?? metadata.endpoint;
  const context = await service.resolveUploadContext(req, {
    conversationId: metadata.conversationId,
    endpoint: requestedEndpoint,
    spec: metadata.spec,
    model: metadata.model,
  });
  if (context.route !== 'public' && metadata.tool_resource === EToolResources.file_search) {
    throw new OcrError(
      'private_destination',
      'File search is not available in a private or local conversation',
    );
  }
  /** The next turn runs on what the composer names now; the stored record fills gaps. */
  const modelContext = {
    endpoint: requestedEndpoint ?? context.endpoint,
    model: agentModel ?? metadata.model ?? context.model,
  };
  const forceText =
    !metadata.tool_resource &&
    isPdfUpload(file) &&
    !conversationReadsPdfs(modelContext, config, acceptsFiles);
  return { route: context.route, forceText };
}

/** Whether a context ("as text") upload is read by `documentOcr` instead of the parsers. */
export function usesDocumentOcrForText(
  plan: DocumentOcrUploadPlan | null | undefined,
  file: Pick<OcrUploadFile, 'mimetype' | 'originalname'>,
): plan is DocumentOcrUploadPlan {
  return plan != null && isDocumentOcrType(file.mimetype, file.originalname);
}

export interface UploadOcrParams {
  req: ServerRequest;
  res?: Response;
  file: OcrUploadFile;
  plan: DocumentOcrUploadPlan;
  service: DocumentOcrService;
  conversationId?: string;
}

/** Reads an uploaded PDF or image through `documentOcr` (billed once, here). */
export async function extractUploadDocumentText({
  req,
  res,
  file,
  plan,
  service,
  conversationId,
}: UploadOcrParams): Promise<{ text: string; ocr: TFileOcr }> {
  const buffer = await fs.promises.readFile(file.path);
  const { text, ocr } = await service.extract({
    req,
    res,
    buffer,
    mimetype: file.mimetype,
    filename: file.originalname,
    route: plan.route,
    conversationId,
  });
  return { text, ocr };
}

export interface OcrEmbeddingFile extends OcrUploadFile {
  size: number;
}

export interface OcrEmbedding {
  /** The text as a `.txt` upload for the RAG API (same `file_id`, original display name). */
  file: OcrEmbeddingFile;
  text: string;
  ocr: TFileOcr;
  cleanup: () => Promise<void>;
}

/**
 * For file search: the RAG API embeds what it can parse from the original file, which for a
 * scanned PDF is nothing and for a Persian text layer is often shaped or reversed text. Every PDF
 * is therefore read through `documentOcr` (text-layer pages free, scanned pages OCR'd) and the
 * normalized text is embedded instead. `null` when there is no text to embed, so the caller keeps
 * the original file.
 */
export async function prepareOcrEmbedding(
  params: UploadOcrParams & { fileId: string },
): Promise<OcrEmbedding | null> {
  const { file, fileId } = params;
  if (!isPdfUpload(file)) {
    return null;
  }
  const { text, ocr } = await extractUploadDocumentText(params);
  if (!hasExtractedText(text)) {
    return null;
  }
  const directory = path.join(path.dirname(file.path), `ocr-${path.basename(fileId)}`);
  await fs.promises.mkdir(directory, { recursive: true });
  const base = path.parse(file.originalname).name || 'document';
  const textPath = path.join(directory, `${base}.txt`);
  await fs.promises.writeFile(textPath, text, 'utf8');
  return {
    file: {
      path: textPath,
      mimetype: 'text/plain',
      originalname: file.originalname,
      size: Buffer.byteLength(text, 'utf8'),
    },
    text,
    ocr,
    cleanup: () => fs.promises.rm(directory, { recursive: true, force: true }),
  };
}

export interface UploadOcrRequest {
  req: ServerRequest;
  res?: Response;
  file: OcrUploadFile;
  metadata: OcrUploadMetadata & { documentOcrPlan?: DocumentOcrUploadPlan | null };
  service: DocumentOcrService;
}

/** The plan the upload route made, or the same decision made now (the conversation read is
 * shared per request). */
async function ensurePlan({
  req,
  file,
  metadata,
  service,
}: UploadOcrRequest): Promise<DocumentOcrUploadPlan | null> {
  if (metadata.documentOcrPlan !== undefined) {
    return metadata.documentOcrPlan;
  }
  return planDocumentOcrUpload({ req, metadata, file, service });
}

/**
 * The context ("as text") path for a PDF or image when `documentOcr` is on: text-layer pages are
 * kept, scanned pages OCR'd through the conversation's route, the extraction billed once.
 */
export async function readUploadWithDocumentOcr(
  request: UploadOcrRequest,
): Promise<{ text: string; ocr: TFileOcr }> {
  const plan = await ensurePlan(request);
  if (!plan) {
    throw new OcrError('disabled', 'Document OCR is disabled');
  }
  const { text, ocr } = await extractUploadDocumentText({
    ...request,
    plan,
    conversationId: request.metadata.conversationId,
  });
  if (!hasExtractedText(text)) {
    throw new Error(
      `Unable to extract text from "${request.file.originalname}". No text was found on its pages.`,
    );
  }
  return { text, ocr };
}

/** The file-search path: the PDF's extracted text to embed in its place, see
 * {@link prepareOcrEmbedding}; `null` keeps the original flow. */
export async function prepareUploadOcrEmbedding(
  request: UploadOcrRequest & { fileId: string },
): Promise<OcrEmbedding | null> {
  if (!isPdfUpload(request.file)) {
    return null;
  }
  const plan = await ensurePlan(request);
  if (!plan) {
    return null;
  }
  return prepareOcrEmbedding({
    ...request,
    plan,
    conversationId: request.metadata.conversationId,
  });
}
