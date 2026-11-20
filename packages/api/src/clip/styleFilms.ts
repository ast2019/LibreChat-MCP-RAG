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

/** Native Remotion size of style films (4:5); the animation itself is 5s and loops. */
export const STYLE_FILM_SIZE = { width: 1080, height: 1350, nativeLoopSec: 5 } as const;

/** Longest style film in seconds (worker default `REMOTION_STYLE_FILM_MAX_SEC`). */
export const STYLE_FILM_MAX_SEC = 15;

/** Longest 3D style film (worker default `REMOTION_STYLE_FILM_3D_MAX_SEC`): software rasterizer. */
export const STYLE_FILM_3D_MAX_SEC = 6;

/** Themes capped at {@link STYLE_FILM_3D_MAX_SEC}. Keep in sync with `THEMES_3D` in the worker. */
export const STYLE_FILM_3D_THEMES: ReadonlySet<string> = new Set(['brick-toy', 'claymation']);

/** Longest clip in seconds for a style-film theme (before the deployment's own cap). */
export function styleFilmMaxSec(theme: string): number {
  return STYLE_FILM_3D_THEMES.has(theme) ? STYLE_FILM_3D_MAX_SEC : STYLE_FILM_MAX_SEC;
}

export function usesStyleFilm(theme: string): boolean {
  return STYLE_FILM_THEMES.has(theme);
}
