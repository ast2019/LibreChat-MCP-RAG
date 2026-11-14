import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPublicAddress } from './address.mjs';

/** A failure the user can act on; `code` is stable, `message` is safe to show (no secrets). */
export class SiteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * The user's site address: https only, a host, one of `ports`, and no credentials, query or
 * fragment. A literal IP must be public; names are checked at connect. `allowHttp` is for tests
 * only: it also accepts http and any port.
 */
export function readSiteUrl(value, { ports, allowHttp = false }) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new SiteError('invalid_url', 'The site address is not a valid URL.');
  }
  const httpsOnly = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:');
  if (!httpsOnly || url.hostname === '') {
    throw new SiteError('invalid_url', 'The site address must start with https://.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SiteError('invalid_url', 'The site address must not contain a user, query or #.');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!allowHttp && !ports.includes(port)) {
    throw new SiteError('invalid_url', `The site address may only use port ${ports.join(' or ')}.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new SiteError('blocked_address', 'The site address points to a private network.');
  }
  return url;
}

/** Resolves a host name and refuses it unless every address is on the public internet. */
export function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      callback(new SiteError('blocked_address', 'The site resolves to a private network.'));
      return;
    }
    if (options?.all) {
      callback(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: publicLookup, timeout: 10_000 },
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

/**
 * `fetch` that reaches only public addresses (every connection, including after DNS changes,
 * goes through {@link publicLookup}) and never follows redirects, so credentials are sent to
 * the address the user entered and nowhere else.
 */
export function createSiteFetch({ dispatcher = agent, timeoutMs = 120_000 } = {}) {
  return async (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response;
    try {
      response = await undiciFetch(input, { ...init, signal, dispatcher, redirect: 'manual' });
    } catch (error) {
      throw toSiteError(error);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new SiteError(
        'redirected',
        'The site redirected the request; enter the final https address (with or without www).',
      );
    }
    return response;
  };
}

/** The error a failed connection becomes, without the URL or headers in it. */
export function toSiteError(error) {
  if (error instanceof SiteError) {
    return error;
  }
  const cause = error?.cause ?? error;
  if (cause instanceof SiteError) {
    return cause;
  }
  if (error?.name === 'TimeoutError' || cause?.name === 'TimeoutError') {
    return new SiteError('timeout', 'The site did not answer in time.');
  }
  const code = String(cause?.code ?? '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new SiteError('not_found', 'The site address could not be found.');
  }
  if (
    code.startsWith('ERR_TLS') ||
    code.includes('CERT') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) {
    return new SiteError('tls', 'The site certificate is not valid for this address.');
  }
  return new SiteError('unreachable', 'The site could not be reached.');
}
