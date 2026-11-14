import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readCpanelCredentials, registerCpanelTools } from './cpanel.mjs';
import { readWordpressCredentials, registerWordpressProxy } from './wordpress.mjs';
import { readNewswatchCredentials, registerNewswatchProxy } from './newswatch.mjs';
import { SiteError } from './egress.mjs';

const BODY_LIMIT = 256 * 1024;
const VERSION = '1.0.0';

const CPANEL_INSTRUCTIONS =
  "Manages the user's own cPanel hosting account with a curated set of tools. Read before you " +
  'change anything. Every change needs confirm: true, which you may set only after showing the ' +
  'user exactly what will change and getting an explicit yes. Never invent passwords, domains or ' +
  'file contents; ask. Answer in the user’s language.';

const WORDPRESS_INSTRUCTIONS =
  "Works on the user's own WordPress site through its MCP Adapter plugin, as the user's own " +
  'WordPress account. Discover the abilities first, then read before you change. Before any ' +
  'change (publishing, editing or deleting), show the user what will change and wait for a yes. ' +
  'Answer in the user’s language.';

/** The two endpoints: each builds an MCP server for one request's account. */
const ENDPOINTS = {
  '/cpanel/mcp': (headers, options) => {
    const credentials = readCpanelCredentials(headers, options);
    const server = new McpServer(
      { name: 'cpanel', version: VERSION },
      { instructions: CPANEL_INSTRUCTIONS },
    );
    registerCpanelTools(server, credentials, options);
    return server;
  },
  '/wordpress/mcp': (headers, options) => {
    const credentials = readWordpressCredentials(headers, options);
    const server = new Server(
      { name: 'wordpress', version: VERSION },
      { capabilities: { tools: { listChanged: false } }, instructions: WORDPRESS_INSTRUCTIONS },
    );
    registerWordpressProxy(server, credentials, options);
    return server;
  },
  '/newswatch/mcp': (headers, options) => {
    const credentials = readNewswatchCredentials(headers, options);
    const server = new Server(
      { name: 'newswatch', version: VERSION },
      { capabilities: { tools: { listChanged: false } }, instructions: NEWSWATCH_INSTRUCTIONS },
    );
    registerNewswatchProxy(server, credentials, options);
    return server;
  },
};

const NEWSWATCH_INSTRUCTIONS =
  "Reads news from the user's own NewsWatch account (read only). Prefer latest_news and " +
  'search_news for simple questions, advanced_search or semantic_search for research, and ' +
  'list_clusters / cluster_timeline for how a story spread. Cite each item with its title, ' +
  'source, date and link. Answer in the user’s language.';

const sendJson = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
};

/** A JSON-RPC error before any MCP server exists (bad credentials, bad body). */
const rpcError = (res, status, message, id = null) =>
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id });

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new SiteError('too_large', 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * The HTTP handler: `GET /health`, and `POST /{cpanel,wordpress,newswatch}/mcp` in stateless
 * Streamable HTTP (one MCP server per request, JSON responses). Only the api service, which
 * holds `SITE_MCP_TOKEN`, may call it; the user's site credentials arrive as headers.
 */
export function createHandler({ token, allowHttp = false, fetch, env = process.env } = {}) {
  if (!token || token.length < 32) {
    throw new Error('SITE_MCP_TOKEN must be set (at least 32 characters)');
  }
  const options = { allowHttp, env, ...(fetch ? { fetch } : {}) };
  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    const build = ENDPOINTS[path];
    if (!build) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (!sameSecret(req.headers['x-site-mcp-token'], token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      rpcError(res, error instanceof SiteError ? 413 : 400, 'Invalid JSON body');
      return;
    }
    let server;
    try {
      server = build(req.headers, options);
    } catch (error) {
      const message =
        error instanceof SiteError ? `${error.code}: ${error.message}` : 'Bad request';
      rpcError(res, 400, message, body?.id ?? null);
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) {
        rpcError(res, 500, 'Internal error', body?.id ?? null);
      }
    }
  };
}

export function startServer(env = process.env) {
  const port = Number(env.PORT || 3200);
  const handler = createHandler({ token: env.SITE_MCP_TOKEN });
  const server = http.createServer(handler);
  server.requestTimeout = 300_000;
  server.listen(port, () => {
    console.log(`[site-mcp] listening on ${port}`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startServer();
}
