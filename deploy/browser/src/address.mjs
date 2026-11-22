export { isPublicAddress } from './blocklist.mjs';

/** Ports pages may connect to: plain and secure web only. */
export const WEB_PORTS = Object.freeze([80, 443]);

/** The URL the session may open: http(s) only, with a host. Throws `invalid_url` otherwise. */
export function readWebUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw Object.assign(new Error('Not a URL'), { code: 'invalid_url' });
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
    throw Object.assign(new Error('Only http and https addresses open'), { code: 'invalid_url' });
  }
  return url;
}
