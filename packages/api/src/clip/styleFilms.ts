/**
 * Themes that render as full Remotion style films from the vendored
 * animation-styles catalog. Keep in sync with `deploy/remotion/src/themeMap.ts`.
 */
export const STYLE_FILM_THEMES: ReadonlySet<string> = new Set([
  'chalkboard',
  'pixel-art',
  'flat-vector',
  'woodblock-print',
  'cartoon-1930s',
  'brick-toy',
  'paper-cut',
  'maths-diagram',
  'cartoon-explainer',
  'blueprint',
  'watercolor',
  'claymation',
]);

/** Native Remotion size of style films (4:5). */
export const STYLE_FILM_SIZE = { width: 1080, height: 1350, durationSec: 5 } as const;

export function usesStyleFilm(theme: string): boolean {
  return STYLE_FILM_THEMES.has(theme);
}
