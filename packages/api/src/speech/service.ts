import { logger } from '@librechat/data-schemas';
import { Constants, ViolationTypes } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  SpeechRoute,
  SpeechTarget,
  HiveSttConfig,
  HiveTtsConfig,
  SpeechProviderClient,
} from './types';
import type { BalanceReservation, CheckBalanceDeps } from '~/middleware/checkBalance';
import type { SpeechRouteFields, SpeechConversationRecord } from './route';
import type { ServerRequest } from '~/types';
import {
  usdToCredits,
  secondsToUsd,
  estimateSpeechSeconds,
  estimateRecordingSeconds,
} from './pricing';
import { resolveHiveSttConfig, resolveHiveTtsConfig, resolveSpeechEndpoint } from './config';
import { audioFormat, pcmSeconds, pcmToWav, splitSpeechText } from './audio';
import { SpeechError, isSpeechError, speechErrorStatus } from './types';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { checkBalance } from '~/middleware/checkBalance';
import { createSpeechProviderClient } from './client';
import { resolveSpeechRoute } from './route';

/** Transaction context of server transcription spend. */
export const STT_TRANSACTION_CONTEXT = 'stt';
/** Transaction context of server speech synthesis spend. */
export const TTS_TRANSACTION_CONTEXT = 'tts';

/** A speech charge as `createTransaction` records it: credits at rate 1 (already priced). */
export interface SpeechCreditTxData {
  user: string;
  conversationId?: string;
  model: string;
  endpoint: string;
  context: string;
  tokenType: 'credits';
  rawAmount: number;
  endpointTokenConfig: Record<string, Record<string, number>>;
  balance?: { enabled?: boolean };
  transactions?: { enabled?: boolean };
}

export interface HiveSpeechServiceDeps {
  getMultiplier: CheckBalanceDeps['getMultiplier'];
  reserveBalance: CheckBalanceDeps['reserveBalance'];
  renewBalanceReservation: CheckBalanceDeps['renewBalanceReservation'];
  releaseBalanceReservation: CheckBalanceDeps['releaseBalanceReservation'];
  logViolation: CheckBalanceDeps['logViolation'];
  createTransaction: (txData: SpeechCreditTxData) => Promise<unknown>;
  getConvo: (user: string, conversationId: string) => Promise<SpeechConversationRecord | null>;
  /** Defaults to the OpenAI-compatible `/audio/*` client over global `fetch`. */
  client?: SpeechProviderClient;
  /** Waits between cost lookups; overridable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TranscribeParams {
  req: ServerRequest;
  res?: Response;
  buffer: Buffer;
  mimetype: string;
  filename?: string;
  language?: string;
  fields: SpeechRouteFields;
  signal?: AbortSignal;
}

export interface TranscribeOutcome {
  text: string;
  credits: number;
  route: SpeechRoute;
  model: string;
}

export interface SynthesizeParams {
  req: ServerRequest;
  res?: Response;
  text: string;
  voice?: string;
  fields: SpeechRouteFields;
  signal?: AbortSignal;
  /** Receives each synthesized piece as it arrives (mp3 output only; WAV needs the whole audio). */
  onAudio?: (piece: Buffer) => Promise<void> | void;
}

export interface SynthesizeOutcome {
  /** Complete audio; for `pcm` output a WAV file. */
  audio: Buffer;
  contentType: 'audio/wav' | 'audio/mpeg';
  route: SpeechRoute;
  voice: string;
  /** Settles once the spend is recorded and the hold released (cost lookups run after the
   *  audio is returned); resolves to the credits charged. Never rejects. */
  billed: Promise<number>;
}

export interface HiveSpeechService {
  /** Route the request's conversation uses; throws `local_route` never (callers decide). */
  resolveRoute: (
    req: ServerRequest,
    fields: SpeechRouteFields,
    config: { localEndpoints: string[]; privateEndpoints: string[] },
  ) => Promise<SpeechRoute>;
  transcribe: (params: TranscribeParams) => Promise<TranscribeOutcome>;
  synthesize: (params: SynthesizeParams) => Promise<SynthesizeOutcome>;
  /** Voices offered by `speech.tts.hive`. */
  getVoices: (appConfig?: AppConfig | null) => string[];
}

function isPersistedConversationId(id: string | undefined): id is string {
  return typeof id === 'string' && id !== '' && id !== Constants.NEW_CONVO && id !== 'new';
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

/** ISO-639-1 code of a locale (`fa-IR` → `fa`), or `undefined` when it is not one. */
export function toSpeechLanguage(language: string | undefined): string | undefined {
  const primary = (language ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

/** The voice to use: the requested one when offered, else the first configured. */
export function pickVoice(voices: readonly string[], requested?: string): string {
  return requested && voices.includes(requested) ? requested : voices[0];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Billed, privacy-routed server speech (`speech.stt.hive` / `speech.tts.hive`). Each request is
 * routed like a document upload (`local` never leaves the device, `private` is zero-data-
 * retention), held against the balance at an upper-bound estimate, and charged what the provider
 * reported — USD × the endpoint's `priceMultiplier` × 1,000,000 credits, as chat is.
 */
export function createHiveSpeechService(deps: HiveSpeechServiceDeps): HiveSpeechService {
  const client = deps.client ?? createSpeechProviderClient();
  const sleep = deps.sleep ?? defaultSleep;

  async function resolveRoute(
    req: ServerRequest,
    fields: SpeechRouteFields,
    config: { localEndpoints: string[]; privateEndpoints: string[] },
  ): Promise<SpeechRoute> {
    const userId = req.user?.id;
    let stored: SpeechConversationRecord | null = null;
    if (userId && isPersistedConversationId(fields.conversationId)) {
      stored = await deps.getConvo(userId, fields.conversationId);
    }
    return resolveSpeechRoute({
      requested: fields,
      stored,
      specs: req.config?.modelSpecs?.list,
      localEndpoints: config.localEndpoints,
      privateEndpoints: config.privateEndpoints,
    });
  }

  function resolveTarget(
    appConfig: AppConfig | undefined,
    config: HiveSttConfig | HiveTtsConfig,
    route: SpeechRoute,
  ): SpeechTarget {
    if (route === 'local') {
      throw new SpeechError('local_route', 'Local conversations use on-device speech only');
    }
    const routeConfig = config[route];
    if (!routeConfig) {
      throw new SpeechError('route_not_configured', `Server speech has no ${route} route`);
    }
    const endpoint = resolveSpeechEndpoint(appConfig, routeConfig.endpoint);
    if (!endpoint) {
      throw new SpeechError(
        'endpoint_not_found',
        `Speech endpoint "${routeConfig.endpoint}" is not configured with server credentials`,
      );
    }
    return { ...endpoint, route, endpoint: routeConfig.endpoint, model: routeConfig.model };
  }

  async function reserve(
    req: ServerRequest,
    res: Response | undefined,
    target: SpeechTarget,
    credits: number,
  ): Promise<BalanceReservation | undefined> {
    const balanceConfig = getBalanceConfig(req.config);
    const userId = req.user?.id;
    if (balanceConfig?.enabled !== true || !userId || credits <= 0) {
      return undefined;
    }
    try {
      return await checkBalance(
        {
          req,
          res: res as Response,
          txData: {
            user: userId,
            model: target.model,
            endpoint: target.endpoint,
            amount: Math.ceil(credits),
          },
        },
        {
          /** The amount is already in credits: the estimate priced it at the selling price. */
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
        throw new SpeechError(
          'insufficient_balance',
          'Balance does not cover the speech estimate',
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  async function record(
    req: ServerRequest,
    fields: SpeechRouteFields,
    target: SpeechTarget,
    context: string,
    credits: number,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId || !(credits > 0)) {
      return;
    }
    try {
      await deps.createTransaction({
        user: userId,
        conversationId: isPersistedConversationId(fields.conversationId)
          ? fields.conversationId
          : undefined,
        model: target.model,
        endpoint: target.endpoint,
        context,
        tokenType: 'credits',
        rawAmount: -credits,
        endpointTokenConfig: { [target.model]: { credits: 1 } },
        balance: getBalanceConfig(req.config) ?? undefined,
        transactions: getTransactionsConfig(req.config),
      });
    } catch (error) {
      logger.error(`[speech] Failed to record ${context} spend`, error);
    }
  }

  async function transcribe(params: TranscribeParams): Promise<TranscribeOutcome> {
    const { req, buffer } = params;
    const config = resolveHiveSttConfig(req.config);
    if (!config) {
      throw new SpeechError('disabled', 'Server transcription is not configured');
    }
    if (buffer.byteLength === 0) {
      throw new SpeechError('empty_input', 'No audio was uploaded');
    }
    if (buffer.byteLength > config.maxBytes) {
      throw new SpeechError('too_large', `Audio exceeds ${config.maxBytes} bytes`);
    }
    const format = audioFormat(params.mimetype, params.filename);
    if (!format) {
      throw new SpeechError('unsupported_format', 'Audio format is not supported');
    }
    const route = await resolveRoute(req, params.fields, config);
    const target = resolveTarget(req.config, config, route);

    const estimateSeconds = estimateRecordingSeconds(buffer.byteLength, config.maxDurationSeconds);
    const estimate = usdToCredits(
      secondsToUsd(estimateSeconds, config.estimateUsdPerMinute),
      target.priceMultiplier,
    );
    const reservation = await reserve(req, params.res, target, estimate);
    try {
      const result = await client.transcribe({
        target,
        audio: buffer,
        format,
        mimetype: params.mimetype,
        language: toSpeechLanguage(params.language) ?? toSpeechLanguage(config.language),
        timeoutMs: config.timeoutMs,
        signal: params.signal,
      });
      const usd =
        result.costUsd ??
        secondsToUsd(result.seconds ?? estimateSeconds, config.estimateUsdPerMinute);
      const credits = usdToCredits(usd, target.priceMultiplier);
      await record(req, params.fields, target, STT_TRANSACTION_CONTEXT, credits);
      if (!result.text) {
        throw new SpeechError('empty_transcript', 'No speech was recognized');
      }
      return { text: result.text, credits, route, model: target.model };
    } finally {
      await reservation?.release();
    }
  }

  async function chargeSynthesis(
    params: SynthesizeParams,
    config: HiveTtsConfig,
    target: SpeechTarget,
    pieces: Array<{ generationId?: string; fallbackUsd: number }>,
    reservation: BalanceReservation | undefined,
  ): Promise<number> {
    try {
      let usd = 0;
      for (const piece of pieces) {
        let cost: number | undefined;
        if (piece.generationId) {
          for (let attempt = 0; attempt < config.costLookupAttempts && cost == null; attempt++) {
            await sleep(config.costLookupDelayMs * (attempt + 1));
            cost = await client.getGenerationCost({ target, generationId: piece.generationId });
          }
        }
        usd += cost ?? piece.fallbackUsd;
      }
      const credits = usdToCredits(usd, target.priceMultiplier);
      await record(params.req, params.fields, target, TTS_TRANSACTION_CONTEXT, credits);
      return credits;
    } catch (error) {
      logger.error('[speech] Failed to price speech synthesis', error);
      return 0;
    } finally {
      await reservation?.release();
    }
  }

  async function synthesize(params: SynthesizeParams): Promise<SynthesizeOutcome> {
    const { req } = params;
    const config = resolveHiveTtsConfig(req.config);
    if (!config) {
      throw new SpeechError('disabled', 'Server speech synthesis is not configured');
    }
    const text = params.text.trim();
    if (!text) {
      throw new SpeechError('empty_input', 'No text to speak');
    }
    const route = await resolveRoute(req, params.fields, config);
    const target = resolveTarget(req.config, config, route);
    const voice = pickVoice(config.voices, params.voice);
    const textPieces = splitSpeechText(text, config.chunkChars);

    const estimate = usdToCredits(
      secondsToUsd(
        estimateSpeechSeconds(text.length, config.charsPerSecond),
        config.estimateUsdPerMinute,
      ),
      target.priceMultiplier,
    );
    const reservation = await reserve(req, params.res, target, estimate);

    const audioPieces: Buffer[] = [];
    const charged: Array<{ generationId?: string; fallbackUsd: number }> = [];
    try {
      for (const input of textPieces) {
        const result = await client.synthesize({
          target,
          input,
          voice,
          instructions: config.instructions || undefined,
          responseFormat: config.responseFormat,
          timeoutMs: config.timeoutMs,
          signal: params.signal,
        });
        const seconds =
          config.responseFormat === 'pcm'
            ? pcmSeconds(result.audio.byteLength, config.pcmSampleRate)
            : estimateSpeechSeconds(input.length, config.charsPerSecond);
        charged.push({
          generationId: result.generationId,
          fallbackUsd: secondsToUsd(seconds, config.estimateUsdPerMinute),
        });
        audioPieces.push(result.audio);
        if (config.responseFormat === 'mp3') {
          await params.onAudio?.(result.audio);
        }
      }
    } catch (error) {
      /** Pieces already synthesized were paid for upstream; charge them before failing. */
      void chargeSynthesis(params, config, target, charged, reservation);
      throw error;
    }

    const billed = chargeSynthesis(params, config, target, charged, reservation);
    const joined = Buffer.concat(audioPieces);
    if (config.responseFormat === 'pcm') {
      return {
        audio: pcmToWav(joined, config.pcmSampleRate),
        contentType: 'audio/wav',
        route,
        voice,
        billed,
      };
    }
    return { audio: joined, contentType: 'audio/mpeg', route, voice, billed };
  }

  return {
    resolveRoute,
    transcribe,
    synthesize,
    getVoices: (appConfig) => resolveHiveTtsConfig(appConfig)?.voices ?? [],
  };
}

/** Writes a speech failure as `{ code }` with its status; other errors become a bare 500. */
export function sendSpeechError(res: Response, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (isSpeechError(error)) {
    res.status(speechErrorStatus(error.code)).json({ code: error.code });
    return;
  }
  res.status(500).json({ code: 'provider_failed' });
}
