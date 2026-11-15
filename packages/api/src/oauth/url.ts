function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Public OAuth callback bases must be HTTPS when browsers reach the site over TLS.
 * Coolify often leaves `DOMAIN_SERVER` as `http://host` while Arvan/Cloudflare terminate
 * TLS on `https://host`; OAuth providers (Higgsfield and others) reject or break on the
 * http redirect URI. Localhost stays http for local development.
 */
export function preferPublicHttpsBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || isLocalHostname(url.hostname)) {
      return trimmed;
    }
    url.protocol = 'https:';
    if (url.port === '80') {
      url.port = '';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

/** Join the public API domain and callback path without a duplicate slash. */
export function getOAuthCallbackUrl(baseUrl: string, callbackPath: string): string {
  return `${preferPublicHttpsBaseUrl(baseUrl)}${callbackPath}`;
}
