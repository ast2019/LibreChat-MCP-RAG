/**
 * Themes that render as full Remotion style films (vendored animation-styles +
 * HiveGPT extras), not the text-slide shell. Keep in sync with
 * `deploy/remotion/src/themeMap.ts`.
 */
export const STYLE_FILM_THEMES: ReadonlySet<string> = new Set([
  'comic-art',
  'cgi-motion',
  'lego',
  'chalkboard',
  'pixel-art',
  'flat-vector',
  'zackd-films',
  'glow-sketch',
  'ps2',
  'dan-koe',
  'woodblock-print',
  'noir-comic',
  'cartoon-1930s',
  'brick-toy',
  'clay-diorama',
  'crt-vector',
  'knitted-puppet',
  'sumi-ink',
  'isometric',
  'paper-cut',
  'data-chart-3d',
  'synthwave',
  'explainer-3d',
  'maths-diagram',
  'cartoon-explainer',
  'domino-reveal',
  'glow-atom',
  'blueprint',
  'mosaic',
  'watercolor',
  'threejs-3d',
  'claymation',
]);

/** Native Remotion size of style films (4:5). */
export const STYLE_FILM_SIZE = { width: 1080, height: 1350, durationSec: 5 } as const;

export function usesStyleFilm(theme: string): boolean {
  return STYLE_FILM_THEMES.has(theme);
}
