import { injectBootstrapConfig } from './bootstrap';

const APP_TITLE_SENTINEL = 'data-librechat-app-title="true"';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Emits the deployment's `APP_TITLE` with the HTML shell.
 *
 * The app learns its title from `/api/config`, which answers after the first render, so
 * every surface that names the app (the tab, the sign-in brand panel, the logo's alt text)
 * painted the stock name first and swapped to the deployment's once the config arrived.
 * The server already knows the title when it serves the document: it writes it into
 * `<title>` and the app-name meta tags, and hands it to the client as
 * `window.__LIBRECHAT_CONFIG__.appTitle` for the first render to read.
 *
 * A blank title leaves the shell as built.
 */
export const injectAppTitleBootstrap = (html: string, appTitle?: string | null): string => {
  const title = appTitle?.trim();
  if (!title) {
    return html;
  }
  const escaped = escapeHtml(title);
  /* Replacements are functions so a `$&` or `$1` in the title stays literal. */
  const named = html
    .replace(/<title>[^<]*<\/title>/i, () => `<title>${escaped}</title>`)
    .replace(
      /(<meta\s+name="(?:application-name|apple-mobile-web-app-title)"\s+content=")[^"]*(")/gi,
      (_match, start: string, end: string) => `${start}${escaped}${end}`,
    );
  return injectBootstrapConfig(named, {
    sentinel: APP_TITLE_SENTINEL,
    values: { appTitle: title },
  });
};
