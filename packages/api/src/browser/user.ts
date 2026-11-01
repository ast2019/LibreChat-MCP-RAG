import { logger } from '@librechat/data-schemas';
import { BROWSER_INPUT_KEYS } from 'librechat-data-provider';
import type { TBrowserInput, TBrowserSessionView } from 'librechat-data-provider';
import type { Response } from 'express';
import type { BrowserServiceClient, ServiceSession } from './client';
import type { ServerRequest } from '~/types/http';
import type { BrowserLogStore } from './sessions';
import { BrowserServiceError } from './client';
import { closeUserBrowser } from './sessions';
import { getBrowserConfig } from './config';

type Handler = (req: ServerRequest, res: Response) => Promise<Response | void>;

const SESSION_ID = /^[\w-]{1,64}$/;
const CONVERSATION_ID = /^[\w-]{1,64}$/;
const MAX_TYPED = 500;
const MAX_COORDINATE = 10_000;

const SSE_HEADERS = {
  'Content-Encoding': 'identity',
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** A conversation's browser as the user's live view shows it; never the owner or other ids. */
export function toBrowserSessionView(session: ServiceSession): TBrowserSessionView {
  return {
    id: session.id,
    control: session.control === 'user' ? 'user' : 'model',
    handoff: session.handoff ?? null,
    url: session.url ?? '',
    title: session.title ?? '',
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    idleMs: session.idleMs,
    maxMs: session.maxMs,
  };
}

/** The user's input as the service takes it, or null for anything malformed. */
export function readBrowserInput(body: unknown): TBrowserInput | null {
  const input = (body ?? {}) as Record<string, unknown>;
  const finite = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
  switch (input.type) {
    case 'click':
      return finite(input.x) && finite(input.y)
        ? { type: 'click', x: input.x as number, y: input.y as number }
        : null;
    case 'type':
      return typeof input.text === 'string' && input.text.length > 0
        ? { type: 'type', text: input.text.slice(0, MAX_TYPED) }
        : null;
    case 'key':
      return (BROWSER_INPUT_KEYS as readonly unknown[]).includes(input.key)
        ? { type: 'key', key: input.key as (typeof BROWSER_INPUT_KEYS)[number] }
        : null;
    case 'scroll':
      return finite(input.dy) ? { type: 'scroll', dy: input.dy as number } : null;
    case 'back':
      return { type: 'back' };
    default:
      return null;
  }
}

/** Codes the live view may see; anything else is reported as `unavailable`. */
const PUBLIC_CODES = new Set([
  'not_found',
  'model_control',
  'user_control',
  'invalid_input',
  'input_failed',
]);

/** The status a public refusal answers with. */
function statusOf(code: string): number {
  if (code === 'not_found') {
    return 404;
  }
  return code.endsWith('_control') ? 409 : 422;
}

function failure(res: Response, error: unknown, label: string): Response {
  if (error instanceof BrowserServiceError && PUBLIC_CODES.has(error.code)) {
    return res.status(statusOf(error.code)).json({ error: error.code });
  }
  if (!(error instanceof BrowserServiceError && error.code === 'unavailable')) {
    logger.warn(`[browser] ${label} failed:`, (error as Error)?.message ?? error);
  }
  return res.status(503).json({ error: 'unavailable' });
}

export interface BrowserUserDeps {
  getClient: () => BrowserServiceClient | null;
  log: BrowserLogStore;
}

/**
 * The signed-in user's own browser: which one is open in a conversation, its live view, the
 * user's clicks and typing, taking it from the model and giving it back, and closing it. A
 * browser that is not the user's answers as not found, so its id tells nobody anything.
 */
export function createBrowserUserHandlers(deps: BrowserUserDeps): {
  getSession: Handler;
  view: Handler;
  input: Handler;
  control: Handler;
  close: Handler;
} {
  const userIdOf = (req: ServerRequest) => (req.user?.id ? String(req.user.id) : '');

  async function ownSession(
    req: ServerRequest,
    client: BrowserServiceClient,
  ): Promise<ServiceSession | null> {
    const { id } = (req.params ?? {}) as { id?: string };
    if (typeof id !== 'string' || !SESSION_ID.test(id)) {
      return null;
    }
    const session = await client.getSession(id);
    return session != null && session.owner === userIdOf(req) ? session : null;
  }

  /** The client when the browser is on and the user is signed in; null otherwise. */
  const clientFor = (req: ServerRequest) =>
    getBrowserConfig(req.config).enabled && userIdOf(req) !== '' ? deps.getClient() : null;

  async function getSession(req: ServerRequest, res: Response) {
    const conversationId = (req.query ?? {}).conversationId;
    if (typeof conversationId !== 'string' || !CONVERSATION_ID.test(conversationId)) {
      return res.status(400).json({ error: 'invalid_conversation' });
    }
    const client = clientFor(req);
    if (!client) {
      return res.status(200).json({ session: null });
    }
    try {
      const [session] = await client.listSessions({
        owner: userIdOf(req),
        context: conversationId,
      });
      return res.status(200).json({ session: session ? toBrowserSessionView(session) : null });
    } catch (error) {
      return failure(res, error, 'session lookup');
    }
  }

  async function view(req: ServerRequest, res: Response) {
    const client = clientFor(req);
    if (!client) {
      return res.status(404).json({ error: 'not_found' });
    }
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    let upstream: globalThis.Response;
    try {
      const session = await ownSession(req, client);
      if (!session) {
        return res.status(404).json({ error: 'not_found' });
      }
      const config = getBrowserConfig(req.config);
      upstream = await client.frames(session.id, {
        fps: config.liveFps,
        quality: config.liveQuality,
        signal: controller.signal,
      });
    } catch (error) {
      return failure(res, error, 'live view');
    }
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders?.();
    try {
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        if (res.writableEnded) {
          break;
        }
        /* A slow viewer holds the stream back; the service then drops frames instead of piling them up. */
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => {
            res.once('drain', resolve);
            res.once('close', resolve);
          });
        }
      }
    } catch {
      /* the viewer left, or the browser closed */
    } finally {
      controller.abort();
      res.end();
    }
  }

  async function input(req: ServerRequest, res: Response) {
    const client = clientFor(req);
    const parsed = readBrowserInput(req.body);
    if (!parsed) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    if (!client) {
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const session = await ownSession(req, client);
      if (!session) {
        return res.status(404).json({ error: 'not_found' });
      }
      return res.status(200).json(await client.input(session.id, parsed));
    } catch (error) {
      return failure(res, error, 'input');
    }
  }

  async function control(req: ServerRequest, res: Response) {
    const to = ((req.body ?? {}) as { to?: unknown }).to;
    if (to !== 'user' && to !== 'model') {
      return res.status(400).json({ error: 'invalid_control' });
    }
    const client = clientFor(req);
    if (!client) {
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const session = await ownSession(req, client);
      if (!session) {
        return res.status(404).json({ error: 'not_found' });
      }
      const updated = await client.setControl(session.id, to);
      return res.status(200).json({ session: toBrowserSessionView(updated) });
    } catch (error) {
      return failure(res, error, 'control');
    }
  }

  async function close(req: ServerRequest, res: Response) {
    const client = clientFor(req);
    if (!client) {
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const session = await ownSession(req, client);
      if (!session) {
        return res.status(404).json({ error: 'not_found' });
      }
      const ended = await closeUserBrowser({ sessionId: session.id, client, log: deps.log });
      return res.status(200).json({ closed: ended != null });
    } catch (error) {
      return failure(res, error, 'close');
    }
  }

  return { getSession, view, input, control, close };
}
