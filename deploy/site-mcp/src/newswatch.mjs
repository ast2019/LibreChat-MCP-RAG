import { SiteError, readSiteUrl } from './egress.mjs';
import { registerProxy } from './proxy.mjs';

const NEWSWATCH_PORTS = Object.freeze([443]);
/** NewsWatch personal tokens: `nwt_` and a url-safe random part. */
const TOKEN = /^nwt_[A-Za-z0-9_-]{20,128}$/;

const MESSAGES = {
  unauthorized:
    'NewsWatch refused the token: it may be revoked or expired, or the password was changed. ' +
    'Create a new one in NewsWatch (Settings → Account → API tokens).',
  notFound: 'NewsWatch has no MCP endpoint at the configured address.',
};

/**
 * The deployment's NewsWatch MCP address (`NEWSWATCH_MCP_URL`, e.g. https://news.example.com/mcp)
 * and the user's personal token. Unset, the integration answers that it is not set up.
 */
export function readNewswatchCredentials(headers, { allowHttp = false, env = process.env } = {}) {
  const configured = String(env.NEWSWATCH_MCP_URL ?? '').trim();
  if (!configured) {
    throw new SiteError('not_configured', 'NewsWatch is not set up on this server yet.');
  }
  const endpoint = readSiteUrl(configured, { ports: NEWSWATCH_PORTS, allowHttp });
  const token = String(headers['x-newswatch-token'] ?? '').trim();
  if (!TOKEN.test(token)) {
    throw new SiteError(
      'invalid_token',
      'Enter a NewsWatch API token (it starts with nwt_), from Settings → Account → API tokens.',
    );
  }
  return { endpoint, authorization: `Bearer ${token}` };
}

/** NewsWatch's read-only tools, as the user's own NewsWatch account. */
export function registerNewswatchProxy(server, credentials, options = {}) {
  registerProxy(server, credentials, options, MESSAGES);
}
