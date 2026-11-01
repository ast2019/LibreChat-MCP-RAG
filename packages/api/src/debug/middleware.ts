import { logger } from '@librechat/data-schemas';
import type { NextFunction, Request, Response } from 'express';
import type { DebugTraceSink } from './recorder';
import type { DebugMode } from './mode';
import { DebugRecorder, runWithDebugRecorder } from './recorder';

/** The response header that names a traced request's trace, for finding it in the admin panel */
export const DEBUG_TRACE_HEADER = 'X-Debug-Trace';

export type ChatRequest = Request & { user?: { id?: string; role?: string } };
export type DebugTraceMiddleware = (
  req: ChatRequest,
  res: Response,
  next: NextFunction,
) => Promise<void>;

const str = (value: unknown, max = 200) =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;

/**
 * What a chat request asked for, without its text: endpoint, model, spec, agent, the composer
 * toggles (`ephemeralAgent`) and the shape of the turn.
 */
export function summarizeChatRequest(req: ChatRequest): Record<string, unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ephemeral = body.ephemeralAgent;
  let toggles: Record<string, unknown> | undefined;
  if (ephemeral && typeof ephemeral === 'object') {
    toggles = {};
    for (const [key, value] of Object.entries(ephemeral as Record<string, unknown>)) {
      if (typeof value === 'boolean' || typeof value === 'number') {
        toggles[key] = value;
      } else if (Array.isArray(value)) {
        toggles[key] = value.filter((item) => typeof item === 'string').slice(0, 50);
      } else if (typeof value === 'string') {
        toggles[key] = value.slice(0, 200);
      }
    }
  }
  return {
    method: req.method,
    path: str(req.originalUrl ?? req.url, 300),
    role: req.user?.role,
    endpoint: str(body.endpoint),
    endpointType: str(body.endpointType),
    model: str(body.model),
    spec: str(body.spec),
    agent_id: str(body.agent_id),
    conversationId: str(body.conversationId, 100),
    hasParent: typeof body.parentMessageId === 'string',
    isRegenerate: body.isRegenerate === true,
    isContinued: body.isContinued === true,
    files: Array.isArray(body.files) ? body.files.length : 0,
    textChars: typeof body.text === 'string' ? body.text.length : 0,
    ...(toggles && { ephemeralAgent: toggles }),
  };
}

/**
 * Starts a trace for each chat request while debug mode is on and runs the rest of the request
 * inside it, so `debugTrace` calls and log lines anywhere below land in that trace.
 */
export function createDebugTraceMiddleware({
  debugMode,
  sink,
}: {
  debugMode: DebugMode;
  sink: DebugTraceSink;
}): DebugTraceMiddleware {
  const onFlushError = (error: unknown) =>
    logger.warn('[debug] Could not store a debug trace', { error: (error as Error)?.message });

  return async (req: ChatRequest, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    let enabled = false;
    try {
      enabled = (await debugMode.getState()).enabled;
    } catch {
      enabled = false;
    }
    if (!enabled) {
      next();
      return;
    }
    const summary = summarizeChatRequest(req);
    const recorder = new DebugRecorder(
      sink,
      {
        userId: req.user?.id,
        conversationId: summary.conversationId as string | undefined,
        endpoint: summary.endpoint as string | undefined,
        model: summary.model as string | undefined,
        spec: summary.spec as string | undefined,
        path: summary.path as string | undefined,
      },
      onFlushError,
    );
    const started = Date.now();
    recorder.stage('request', summary);
    if (!res.headersSent) {
      res.setHeader(DEBUG_TRACE_HEADER, recorder.traceId);
    }
    let answered = false;
    const onDone = (event: 'finish' | 'close') => {
      if (answered) {
        return;
      }
      answered = true;
      recorder.update({ status: res.statusCode });
      recorder.stage('response', { event, status: res.statusCode, ms: Date.now() - started });
    };
    res.once('finish', () => onDone('finish'));
    res.once('close', () => onDone('close'));
    runWithDebugRecorder(recorder, () => next());
  };
}
