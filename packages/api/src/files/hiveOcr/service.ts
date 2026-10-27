import { Constants, ViolationTypes } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  OcrSpendTxData,
  DocumentOcrDeps,
  OcrCreditTxData,
  OcrReservation,
  DocumentOcrOutcome,
  OcrMultiplierParams,
} from './runtime';
import type { OcrRoute, DocumentOcrConfig, VisionCaller } from './types';
import type { CheckBalanceDeps } from '~/middleware/checkBalance';
import type { OcrRouteSource } from './route';
import type { ServerRequest } from '~/types';
import { resolveCustomEndpointTokenConfig } from '~/endpoints/custom/initialize';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { runDocumentOcr, resolveOcrVisionEndpoint } from './runtime';
import { createOpenAICompatibleVisionCaller } from './vision';
import { checkBalance } from '~/middleware/checkBalance';
import { getCustomEndpointConfig } from '~/app/config';
import { resolveDocumentOcrConfig } from './config';
import { resolveUploadOcrRoute } from './route';
import { isUserProvided } from '~/utils';
import { OcrError } from './types';

/** The stored conversation fields that decide an upload's OCR route. */
export interface OcrConversationRecord {
  endpoint?: string | null;
  spec?: string | null;
  model?: string | null;
}

export interface DocumentOcrServiceDeps {
  getMultiplier: (params: OcrMultiplierParams) => number;
  spendTokens: (
    txData: OcrSpendTxData,
    usage: { promptTokens?: number; completionTokens?: number },
  ) => Promise<unknown>;
  createTransaction: (txData: OcrCreditTxData) => Promise<unknown>;
  reserveBalance: CheckBalanceDeps['reserveBalance'];
  renewBalanceReservation: CheckBalanceDeps['renewBalanceReservation'];
  releaseBalanceReservation: CheckBalanceDeps['releaseBalanceReservation'];
  logViolation: CheckBalanceDeps['logViolation'];
  getConvo: (user: string, conversationId: string) => Promise<OcrConversationRecord | null>;
  /** Defaults to chat's custom-endpoint price resolution (cache, then `/models`). */
  getEndpointTokenConfig?: (
    req: ServerRequest,
    endpoint: string,
  ) => Promise<Record<string, Record<string, number>> | undefined>;
  /** Overrides for tests: the vision call and the extraction internals. */
  callVision?: VisionCaller;
  extract?: Partial<Pick<DocumentOcrDeps, 'runTesseract' | 'renderPages' | 'extractPdfText'>>;
}

/** What the upload request names about the conversation it was made from. */
export interface UploadConversationFields {
  conversationId?: string;
  endpoint?: string;
  spec?: string;
  model?: string;
}

/** The conversation an upload belongs to: its route and the model it currently talks to. */
export interface UploadConversationContext {
  route: OcrRoute;
  endpoint?: string;
  model?: string;
  /** The conversation exists in the database. */
  persisted: boolean;
}

export interface DocumentOcrRequestParams {
  req: ServerRequest;
  res?: Response;
  buffer: Buffer;
  mimetype: string;
  filename: string;
  route: OcrRoute;
  conversationId?: string;
  signal?: AbortSignal;
}

export interface DocumentOcrService {
  /** `documentOcr` of the request's config with defaults applied. */
  getConfig: (appConfig?: AppConfig) => DocumentOcrConfig;
  resolveUploadContext: (
    req: ServerRequest,
    fields: UploadConversationFields,
  ) => Promise<UploadConversationContext>;
  extract: (params: DocumentOcrRequestParams) => Promise<DocumentOcrOutcome>;
}

interface UploadContextCarrier {
  _ocrUploadContext?: Promise<UploadConversationContext>;
}

function isPersistedConversationId(conversationId: string | undefined): conversationId is string {
  return (
    typeof conversationId === 'string' &&
    conversationId !== '' &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== 'new'
  );
}

function parseBalanceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  try {
    const parsed = JSON.parse(error.message) as { type?: string };
    return parsed?.type === ViolationTypes.TOKEN_BALANCE;
  } catch {
    return false;
  }
}

/**
 * Document OCR as the request paths use it: config, the upload's conversation route, chat-priced
 * extraction with balance reservation and spend recording. Created once with the database methods;
 * everything request-specific arrives per call.
 */
export function createDocumentOcrService(deps: DocumentOcrServiceDeps): DocumentOcrService {
  const getConfig = (appConfig?: AppConfig): DocumentOcrConfig =>
    resolveDocumentOcrConfig(appConfig?.config?.documentOcr);

  async function loadUploadContext(
    req: ServerRequest,
    fields: UploadConversationFields,
  ): Promise<UploadConversationContext> {
    const config = getConfig(req.config);
    const userId = req.user?.id;
    let stored: OcrConversationRecord | null = null;
    if (userId && isPersistedConversationId(fields.conversationId)) {
      stored = await deps.getConvo(userId, fields.conversationId);
    }
    const requested: OcrRouteSource = { endpoint: fields.endpoint, spec: fields.spec };
    const route = resolveUploadOcrRoute({
      requested,
      stored,
      specs: req.config?.modelSpecs?.list,
      localEndpoints: config.localEndpoints,
      privateEndpoints: config.privateEndpoints,
    });
    return {
      route,
      endpoint: stored?.endpoint ?? fields.endpoint,
      model: stored?.model ?? fields.model,
      persisted: stored != null,
    };
  }

  /** One conversation read per request, shared by routing, privacy and processing. */
  function resolveUploadContext(
    req: ServerRequest,
    fields: UploadConversationFields,
  ): Promise<UploadConversationContext> {
    const carrier = req as ServerRequest & UploadContextCarrier;
    carrier._ocrUploadContext ??= loadUploadContext(req, fields);
    return carrier._ocrUploadContext;
  }

  async function getEndpointTokenConfig(req: ServerRequest, endpoint: string) {
    const appConfig = req.config;
    const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
    const vision = resolveOcrVisionEndpoint(appConfig, endpoint);
    if (!endpointConfig || !vision) {
      return undefined;
    }
    return resolveCustomEndpointTokenConfig({
      endpoint,
      endpointConfig,
      apiKey: vision.apiKey,
      baseURL: vision.baseURL,
      resolvedBaseURL: vision.baseURL,
      userProvidesURL: isUserProvided(endpointConfig.baseURL ?? ''),
      appConfig,
      user: req.user,
    });
  }

  async function extract(params: DocumentOcrRequestParams): Promise<DocumentOcrOutcome> {
    const { req, res } = params;
    const appConfig = req.config;
    const config = getConfig(appConfig);
    const userId = req.user?.id;
    if (!userId) {
      throw new OcrError('disabled', 'Document OCR needs an authenticated user');
    }
    const balanceConfig = getBalanceConfig(appConfig);
    const callVision =
      deps.callVision ??
      createOpenAICompatibleVisionCaller({
        resolveEndpoint: (name) => resolveOcrVisionEndpoint(appConfig, name),
        timeoutMs: config.timeoutMs,
      });

    const reserveCredits = async ({
      credits,
      model,
      endpoint,
    }: {
      credits: number;
      model: string;
      endpoint: string;
    }): Promise<OcrReservation> => {
      try {
        return await checkBalance(
          {
            req,
            res: res as Response,
            txData: { user: userId, model, endpoint, amount: Math.ceil(credits) },
          },
          {
            /** The amount is already in credits: the estimate priced it at chat's rates. */
            getMultiplier: () => 1,
            reserveBalance: deps.reserveBalance,
            renewBalanceReservation: deps.renewBalanceReservation,
            releaseBalanceReservation: deps.releaseBalanceReservation,
            logViolation: deps.logViolation,
            balanceConfig: balanceConfig ?? undefined,
          },
        );
      } catch (error) {
        if (parseBalanceError(error)) {
          throw new OcrError('insufficient_balance', 'Balance does not cover the OCR estimate', {
            cause: error,
          });
        }
        throw error;
      }
    };

    return runDocumentOcr(
      {
        config,
        route: params.route,
        user: userId,
        conversationId: isPersistedConversationId(params.conversationId)
          ? params.conversationId
          : undefined,
        buffer: params.buffer,
        mimetype: params.mimetype,
        filename: params.filename,
        balance: balanceConfig ?? undefined,
        transactions: getTransactionsConfig(appConfig),
        signal: params.signal,
      },
      {
        callVision,
        getEndpointTokenConfig: (endpoint) =>
          (deps.getEndpointTokenConfig ?? getEndpointTokenConfig)(req, endpoint),
        getMultiplier: deps.getMultiplier,
        reserveCredits,
        spendTokens: deps.spendTokens,
        createTransaction: deps.createTransaction,
        ...deps.extract,
      },
    );
  }

  return { getConfig, resolveUploadContext, extract };
}
