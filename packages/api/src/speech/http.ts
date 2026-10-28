import { promises as fs } from 'fs';
import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { HiveSpeechService, SynthesizeOutcome } from './service';
import type { SpeechRouteFields } from './route';
import type { ServerRequest } from '~/types';
import { getSafeErrorMetadata } from '~/utils/errors';
import { sendSpeechError } from './service';
import { SpeechError } from './types';

/** One incremental piece of an assistant message, as the stream chunk processor yields it. */
export interface SpeechTextUpdate {
  text: string;
  isFinished: boolean;
}

/** Polls the message for new text; a string is a processing failure. */
export type NextSpeechUpdates = () => Promise<SpeechTextUpdate[] | string>;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;

/** The conversation fields a speech request names (multipart or JSON body). */
export function readSpeechRouteFields(body: unknown): SpeechRouteFields {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    conversationId: asString(source.conversationId),
    endpoint: asString(source.endpoint),
    spec: asString(source.spec),
  };
}

function abortSignalFor(req: ServerRequest): AbortSignal {
  const controller = new AbortController();
  req.on?.('close', () => {
    if (!req.complete || req.destroyed) {
      controller.abort();
    }
  });
  return controller.signal;
}

function writeAudio(res: Response, outcome: SynthesizeOutcome): void {
  res.setHeader('Content-Type', outcome.contentType);
  res.setHeader('Content-Length', String(outcome.audio.byteLength));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(outcome.audio);
}

export interface HiveSpeechHttp {
  /** Transcribes `req.file` (multer disk upload) through `speech.stt.hive`. */
  transcribeUpload: (req: ServerRequest, res: Response) => Promise<string>;
  /** `/speech/tts/manual`: synthesizes `text` and writes the audio, or a `{ code }` failure. */
  respondTextToSpeech: (req: ServerRequest, res: Response, text: string) => Promise<void>;
  /** `/speech/tts`: waits for the message to finish, then synthesizes and writes it. */
  respondStreamAudio: (
    req: ServerRequest,
    res: Response,
    nextUpdates: NextSpeechUpdates,
    pollMs?: number,
  ) => Promise<void>;
  sendError: (res: Response, error: unknown) => void;
  getVoices: HiveSpeechService['getVoices'];
}

/** Express-facing wrappers of the hive speech service; `/api` only routes into these. */
export function createHiveSpeechHttp(service: HiveSpeechService): HiveSpeechHttp {
  async function transcribeUpload(req: ServerRequest, res: Response): Promise<string> {
    const file = (req as ServerRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new SpeechError('empty_input', 'No audio file provided');
    }
    const buffer = file.buffer ?? (await fs.readFile(file.path));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const outcome = await service.transcribe({
      req,
      res,
      buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
      language: asString(body.language),
      fields: readSpeechRouteFields(body),
      signal: abortSignalFor(req),
    });
    return outcome.text;
  }

  async function respondTextToSpeech(
    req: ServerRequest,
    res: Response,
    text: string,
  ): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const outcome = await service.synthesize({
        req,
        res,
        text,
        voice: asString(body.voice),
        fields: readSpeechRouteFields(body),
        signal: abortSignalFor(req),
      });
      writeAudio(res, outcome);
    } catch (error) {
      logger.error('[speech] Text to speech failed', getSafeErrorMetadata(error));
      sendSpeechError(res, error);
    }
  }

  async function respondStreamAudio(
    req: ServerRequest,
    res: Response,
    nextUpdates: NextSpeechUpdates,
    pollMs = 1250,
  ): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signal = abortSignalFor(req);
    try {
      const parts: string[] = [];
      let finished = false;
      while (!finished && !signal.aborted) {
        const updates = await nextUpdates();
        if (typeof updates === 'string') {
          throw new Error(`Speech chunk processing failed: ${updates}`);
        }
        if (updates.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }
        for (const update of updates) {
          parts.push(update.text);
          finished ||= update.isFinished;
        }
      }
      if (signal.aborted) {
        return;
      }
      let streamed = false;
      const outcome = await service.synthesize({
        req,
        res,
        text: parts.join(' '),
        voice: asString(body.voice),
        fields: readSpeechRouteFields(body),
        signal,
        onAudio: (piece) => {
          if (!streamed) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'no-store');
            streamed = true;
          }
          res.write(piece);
        },
      });
      if (streamed) {
        res.end();
        return;
      }
      writeAudio(res, outcome);
    } catch (error) {
      logger.error('[speech] Streamed speech failed', getSafeErrorMetadata(error));
      sendSpeechError(res, error);
    }
  }

  return {
    transcribeUpload,
    respondTextToSpeech,
    respondStreamAudio,
    sendError: sendSpeechError,
    getVoices: service.getVoices,
  };
}
