/**
 * The language a visitor without a saved choice gets. HiveGPT is a Persian product, so this is
 * Persian regardless of the browser language; "Auto detect" in settings still follows the
 * browser. It is the language picker's own value, so Settings shows Persian selected.
 * `client/index.html` repeats it for the pre-paint direction.
 */
export const DEFAULT_LANGUAGE = 'fa-IR';
