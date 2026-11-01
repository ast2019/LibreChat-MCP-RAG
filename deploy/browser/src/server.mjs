import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createBrowserLauncher } from './browser.mjs';
import { createLoadMonitor } from './load.mjs';
import { act, openUrl, readPage } from './page.mjs';
import { BrowserError, createSessionManager } from './sessions.mjs';

const BODY_LIMIT = 64 * 1024;
const END_REASONS = new Set(['closed', 'admin']);

/** An integer within bounds, or the fallback when absent or not a number. */
const bounded = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), min), max) : fallback;
};

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new BrowserError('too_large', 'Request body is too large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        return resolve({});
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      } catch {
        reject(new BrowserError('invalid_json', 'The body is not JSON'));
      }
    });
    req.on('error', reject);
  });

const sameToken = (header, token) => {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) {
    return false;
  }
  const given = crypto.createHash('sha256').update(match[1]).digest();
  const expected = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(given, expected);
};

/**
 * The service's HTTP API. Every route but `/health` needs the shared token. `policy` (which
 * addresses and ports count as public) is only replaced in tests.
 */
export function createServer({ manager, monitor, token, policy = {} }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://browser');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true });
      }
      if (!sameToken(req.headers.authorization, token)) {
        return send(res, 401, { error: 'unauthorized' });
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(res, 200, {
          load: monitor.current(),
          history: monitor.history(),
          sessions: manager.list(),
        });
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        return send(
          res,
          200,
          manager.events(bounded(url.searchParams.get('after'), 0, 2 ** 52, 0)),
        );
      }
      if (parts[0] !== 'sessions') {
        return send(res, 404, { error: 'not_found' });
      }
      if (parts.length === 1 && req.method === 'POST') {
        const body = await readBody(req);
        const owner = typeof body.owner === 'string' ? body.owner.slice(0, 64) : '';
        if (owner === '') {
          throw new BrowserError('invalid_owner', 'owner is required');
        }
        const session = await manager.create({
          owner,
          ownerLimit: bounded(body.ownerLimit, 1, 10, 1),
          serverLimit: bounded(body.serverLimit, 1, 100, 10),
          ram: bounded(body.ram, 10, 100, 85),
          cpu: bounded(body.cpu, 10, 100, 90),
          idleMs: bounded(body.idleMs, 30_000, 3_600_000, 180_000),
          maxMs: bounded(body.maxMs, 60_000, 7_200_000, 1_200_000),
        });
        return send(res, 201, { session });
      }
      const id = parts[1];
      if (parts.length === 2 && req.method === 'GET') {
        return send(res, 200, { session: manager.get(id) });
      }
      if (parts.length === 2 && req.method === 'DELETE') {
        const reason = url.searchParams.get('reason');
        const ended = await manager.close(id, END_REASONS.has(reason) ? reason : 'closed');
        return send(res, ended ? 200 : 404, ended ? { session: ended } : { error: 'not_found' });
      }
      if (parts.length === 3 && req.method === 'POST') {
        const body = await readBody(req);
        const run = {
          open: (handle) => openUrl(handle, body.url, policy),
          read: (handle) => readPage(handle, { screenshot: body.screenshot === true }),
          act: (handle) => act(handle, body),
        }[parts[2]];
        if (!run) {
          return send(res, 404, { error: 'not_found' });
        }
        const result = await manager.use(id, async (handle) => ({
          ...(await run(handle)),
          blocked: handle.blocked().slice(-5),
        }));
        return send(res, 200, result);
      }
      return send(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof BrowserError) {
        return send(res, error.status, {
          error: error.code,
          message: error.message,
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }
      console.error('[browser] request failed', error);
      return send(res, 500, { error: 'internal' });
    }
  });
}

async function main() {
  const token = process.env.BROWSER_SERVICE_TOKEN ?? '';
  if (token.length < 32) {
    console.error('[browser] BROWSER_SERVICE_TOKEN must be set (32 characters or more)');
    process.exit(1);
  }
  const port = bounded(process.env.PORT, 1, 65_535, 3100);
  let manager;
  const monitor = createLoadMonitor({ countSessions: () => manager?.count() ?? 0 });
  manager = createSessionManager({ openBrowser: createBrowserLauncher(), monitor });
  monitor.start();
  manager.start();
  const server = createServer({ manager, monitor, token });
  server.listen(port, '0.0.0.0', () => console.log(`[browser] listening on ${port}`));
  const stop = async () => {
    server.close();
    await manager.shutdown();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
