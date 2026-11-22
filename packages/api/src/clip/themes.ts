/**
 * Motion studio themes (palette, typography, background motion, accent shapes). Keep in sync
 * with `THEMES` in `deploy/remotion/src/storyboard.mjs` (themeDrift.spec.ts checks it).
 */
export const CLIP_THEMES = ['midnight', 'aurora', 'daylight', 'sunset', 'editorial', 'neon'] as const;

export type ClipTheme = (typeof CLIP_THEMES)[number];

export const CLIP_THEME_SET: ReadonlySet<string> = new Set(CLIP_THEMES);

/**
 * Pre-0.40 ids. The brand shells map to the closest theme; the chai style films (kettle and cup
 * stories unrelated to the topic) were removed and map to a theme with a note to the model.
 */
export const CLIP_THEME_ALIASES: Readonly<Record<string, ClipTheme>> = {
  'brand-dark': 'midnight',
  'brand-light': 'daylight',
  'ugc': 'editorial',
  'chalkboard': 'midnight',
  'pixel-art': 'neon',
  'flat-vector': 'daylight',
  'woodblock-print': 'editorial',
  'cartoon-1930s': 'editorial',
  'brick-toy': 'sunset',
  'paper-cut': 'editorial',
  'paper-cutout': 'editorial',
  'maths-diagram': 'daylight',
  'cartoon-explainer': 'daylight',
  'blueprint': 'midnight',
  'watercolor': 'sunset',
  'claymation': 'sunset',
};

export function isClipTheme(value: unknown): value is ClipTheme {
  return typeof value === 'string' && CLIP_THEME_SET.has(value);
}

/** A theme id or legacy alias; unknown values fall back to midnight. */
export function resolveClipTheme(value: unknown): ClipTheme {
  if (typeof value !== 'string') {
    return 'midnight';
  }
  const key = value.trim().toLowerCase();
  if (isClipTheme(key)) {
    return key;
  }
  return CLIP_THEME_ALIASES[key] ?? 'midnight';
}

/** Short descriptions for the tool schema and the skill. */
export const CLIP_THEME_LABELS: Readonly<Record<ClipTheme, string>> = {
  midnight: 'deep navy, mint and violet light, drifting gradient mesh (default)',
  aurora: 'near-black, green and purple aurora fields',
  daylight: 'light, clean grid, teal and blue (corporate, education)',
  sunset: 'warm plum to orange glow (lifestyle, culture)',
  editorial: 'paper white, black type, red accent (news, essays)',
  neon: 'black with a cyan and magenta perspective grid (tech, gaming)',
};
