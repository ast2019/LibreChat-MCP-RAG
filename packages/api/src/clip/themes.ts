/**
 * Remotion clip visual shells: brand slides plus catalog-backed style films
 * (deenukhan/animation-styles). Themes without a real film are not listed.
 */
export const CLIP_THEMES = [
  'brand-dark',
  'brand-light',
  'ugc',
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
] as const;

export type ClipTheme = (typeof CLIP_THEMES)[number];

export const CLIP_THEME_SET: ReadonlySet<string> = new Set(CLIP_THEMES);

/** User/skill aliases that map onto a canonical theme id. */
export const CLIP_THEME_ALIASES: Readonly<Record<string, ClipTheme>> = {
  'paper-cutout': 'paper-cut',
};

export function isClipTheme(value: unknown): value is ClipTheme {
  return typeof value === 'string' && CLIP_THEME_SET.has(value);
}

/** Resolve a theme id or known alias; unknown values fall back to brand-dark. */
export function resolveClipTheme(value: unknown): ClipTheme {
  if (typeof value !== 'string') {
    return 'brand-dark';
  }
  const key = value.trim().toLowerCase();
  if (isClipTheme(key)) {
    return key;
  }
  return CLIP_THEME_ALIASES[key] ?? 'brand-dark';
}

/** Short labels for skill prompts and tool descriptions (English ids stay in the enum). */
export const CLIP_THEME_LABELS: Readonly<Record<ClipTheme, string>> = {
  'brand-dark': 'Brand dark',
  'brand-light': 'Brand light',
  'ugc': 'Simple UGC',
  'chalkboard': 'Chalkboard',
  'pixel-art': 'Pixel Art',
  'flat-vector': 'Flat Vector',
  'woodblock-print': 'Woodblock Print',
  'cartoon-1930s': '1930s Cartoon',
  'brick-toy': 'Brick Toy',
  'paper-cut': 'Paper-Cut',
  'maths-diagram': 'Maths Diagram',
  'cartoon-explainer': 'Cartoon Explainer',
  'blueprint': 'Blueprint',
  'watercolor': 'Watercolor',
  'claymation': 'Claymation',
};
