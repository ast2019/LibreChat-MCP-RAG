/**
 * Remotion clip visual shells: brand shells plus Claude-style animation looks
 * the clip-builder skill can pick.
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
] as const;

export type ClipTheme = (typeof CLIP_THEMES)[number];

export const CLIP_THEME_SET: ReadonlySet<string> = new Set(CLIP_THEMES);

/** User/skill aliases that map onto a canonical theme id. */
export const CLIP_THEME_ALIASES: Readonly<Record<string, ClipTheme>> = {
  'neon-synth': 'synthwave',
  'paper-cutout': 'paper-cut',
  'ink-wash': 'sumi-ink',
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
  'woodblock-print': 'Woodblock Print',
  'noir-comic': 'Noir Comic',
  'cartoon-1930s': '1930s Cartoon',
  'brick-toy': 'Brick Toy',
  'clay-diorama': 'Clay Diorama',
  'crt-vector': 'CRT Vector',
  'knitted-puppet': 'Knitted Puppet',
  'sumi-ink': 'Sumi Ink',
  isometric: 'Isometric',
  'paper-cut': 'Paper-Cut',
  'data-chart-3d': '3D Data Chart',
  synthwave: 'Synthwave',
  'explainer-3d': '3D Explainer',
  'maths-diagram': 'Maths Diagram',
  'cartoon-explainer': 'Cartoon Explainer',
  'domino-reveal': 'Domino Reveal',
  'glow-atom': 'Glow Atom',
  blueprint: 'Blueprint',
  mosaic: 'Mosaic',
  watercolor: 'Watercolor',
  'threejs-3d': 'Three.js 3D',
  claymation: 'Claymation',
};
