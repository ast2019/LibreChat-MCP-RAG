/**
 * Remotion clip visual shells: three brand shells plus ten Claude-style
 * animation looks the clip-builder skill can pick.
 */
export const CLIP_THEMES = [
  'brand-dark',
  'brand-light',
  'ugc',
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
] as const;

export type ClipTheme = (typeof CLIP_THEMES)[number];

export const CLIP_THEME_SET: ReadonlySet<string> = new Set(CLIP_THEMES);

export function isClipTheme(value: unknown): value is ClipTheme {
  return typeof value === 'string' && CLIP_THEME_SET.has(value);
}

/** Short labels for skill prompts and tool descriptions (English ids stay in the enum). */
export const CLIP_THEME_LABELS: Readonly<Record<ClipTheme, string>> = {
  'brand-dark': 'Brand dark',
  'brand-light': 'Brand light',
  ugc: 'Simple UGC',
  'comic-art': 'Comic Art',
  'cgi-motion': 'CGI Motion',
  lego: 'Lego Style',
  chalkboard: 'Chalkboard',
  'pixel-art': 'Pixel Art',
  'flat-vector': 'Flat Vector',
  'zackd-films': 'ZackD Films',
  'glow-sketch': 'Glow Sketch',
  ps2: 'PS2 Style',
  'dan-koe': 'Dan Koe Style',
};
