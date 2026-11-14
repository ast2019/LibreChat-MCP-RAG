import { SiteError, readSiteUrl } from './egress.mjs';
import { registerProxy } from './proxy.mjs';

/** The official MCP Adapter plugin's default server, under the site's REST API. */
export const WORDPRESS_MCP_PATH = '/wp-json/mcp/mcp-adapter-default-server';
const WORDPRESS_PORTS = Object.freeze([443]);
const USERNAME = /^[^\s:]{1,60}$/;
/** WordPress shows application passwords in groups of four: `abcd efgh ijkl mnop qrst uvwx`. */
const APP_PASSWORD = /^[A-Za-z0-9 ]{16,64}$/;

const MESSAGES = {
  unauthorized: 'WordPress refused the username or application password.',
  notFoundCode: 'no_mcp_adapter',
  notFound:
    'The site has no MCP endpoint: install and activate the «MCP Adapter» plugin (WordPress 6.9+).',
};

/**
 * The site and the account the request acts on. A bare site address gets the plugin's
 * default path; a full `/wp-json/...` address is used as it is.
 */
export function readWordpressCredentials(headers, { allowHttp = false } = {}) {
  const url = readSiteUrl(headers['x-wordpress-url'], { ports: WORDPRESS_PORTS, allowHttp });
  const username = String(headers['x-wordpress-username'] ?? '').trim();
  const password = String(headers['x-wordpress-app-password'] ?? '').trim();
  if (!USERNAME.test(username)) {
    throw new SiteError('invalid_username', 'The WordPress username is not valid.');
  }
  if (!APP_PASSWORD.test(password)) {
    throw new SiteError(
      'invalid_password',
      'Use a WordPress application password (Users → Profile → Application Passwords).',
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  const endpoint = new URL(path.includes('/wp-json/') ? path : `${path}${WORDPRESS_MCP_PATH}`, url);
  const basic = Buffer.from(`${username}:${password.replace(/ /g, '')}`).toString('base64');
  return { endpoint, authorization: `Basic ${basic}` };
}

/** The site's abilities (through the adapter's tools), as the user's own WordPress account. */
export function registerWordpressProxy(server, credentials, options = {}) {
  registerProxy(server, credentials, options, MESSAGES);
}
