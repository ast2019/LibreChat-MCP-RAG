export type SceneType = 'title' | 'bullets' | 'closing';

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

export type DecorKind =
  | 'none'
  | 'halftone'
  | 'orbs'
  | 'bricks'
  | 'chalk'
  | 'pixels'
  | 'shapes'
  | 'doodle'
  | 'neon'
  | 'scanlines'
  | 'orbit'
  | 'woodblock'
  | 'noir'
  | 'cartoon30s'
  | 'clay'
  | 'crt'
  | 'knit'
  | 'sumi'
  | 'iso'
  | 'papercut'
  | 'chart'
  | 'synthwave'
  | 'explainer3d'
  | 'maths'
  | 'cartoonExp'
  | 'domino'
  | 'atom'
  | 'blueprint'
  | 'mosaic'
  | 'watercolor'
  | 'threejs';

export interface ThemeVisual {
  bg: string;
  fg: string;
  muted: string;
  gradient: string;
  fontFamily: string;
  accentFallback: string;
  decor: DecorKind;
  /** When true, prefer theme accent over brandColor. */
  lockAccent?: boolean;
  direction?: 'rtl' | 'ltr';
  textAlign?: 'right' | 'left' | 'center';
  progressTrack: string;
  titleSize: number;
  headingSize: number;
  bodySize: number;
  brandSize: number;
  letterSpacing?: string;
  fontWeight?: number;
  border?: string;
  textShadow?: string;
  bulletShape: 'dot' | 'square' | 'dash' | 'chalk' | 'pixel' | 'brick';
}

export const THEME_VISUALS: Record<ClipTheme, ThemeVisual> = {
  'brand-dark': {
    bg: '#0b1412',
    fg: '#f4f7f5',
    muted: 'rgba(244,247,245,0.78)',
    gradient: 'radial-gradient(ellipse at 50% 18%, rgba(46, 168, 132, 0.45) 0%, transparent 55%)',
    fontFamily: '"Vazirmatn", "Tahoma", "Segoe UI", system-ui, sans-serif',
    accentFallback: '#2ea884',
    decor: 'none',
    direction: 'rtl',
    textAlign: 'right',
    progressTrack: 'rgba(255,255,255,0.12)',
    titleSize: 56,
    headingSize: 44,
    bodySize: 28,
    brandSize: 26,
    bulletShape: 'dot',
  },
  'brand-light': {
    bg: '#f7faf8',
    fg: '#0b1412',
    muted: 'rgba(11,20,18,0.72)',
    gradient: 'radial-gradient(ellipse at 50% 12%, rgba(46, 168, 132, 0.22) 0%, transparent 55%)',
    fontFamily: '"Vazirmatn", "Tahoma", "Segoe UI", system-ui, sans-serif',
    accentFallback: '#2ea884',
    decor: 'none',
    direction: 'rtl',
    textAlign: 'right',
    progressTrack: 'rgba(0,0,0,0.1)',
    titleSize: 56,
    headingSize: 44,
    bodySize: 28,
    brandSize: 26,
    bulletShape: 'dot',
  },
  ugc: {
    bg: '#121212',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,0.78)',
    gradient: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)',
    fontFamily: '"Vazirmatn", "Tahoma", "Segoe UI", system-ui, sans-serif',
    accentFallback: '#2ea884',
    decor: 'none',
    direction: 'rtl',
    textAlign: 'right',
    progressTrack: 'rgba(255,255,255,0.12)',
    titleSize: 56,
    headingSize: 44,
    bodySize: 28,
    brandSize: 26,
    bulletShape: 'dot',
  },
  chalkboard: {
    bg: '#1f4d2e',
    fg: '#f5f0e1',
    muted: 'rgba(245,240,225,0.82)',
    gradient: 'radial-gradient(ellipse at 40% 30%, rgba(255,255,255,0.06), transparent 50%)',
    fontFamily: '"Comic Sans MS", "Segoe Print", "Vazirmatn", cursive',
    accentFallback: '#f5f0e1',
    decor: 'chalk',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(255,255,255,0.18)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 22,
    textShadow: '1px 1px 0 rgba(0,0,0,0.35)',
    bulletShape: 'chalk',
  },
  'pixel-art': {
    bg: '#1a1c2c',
    fg: '#f4f4f4',
    muted: '#94b0c2',
    gradient: 'none',
    fontFamily: '"Courier New", "Lucida Console", monospace',
    accentFallback: '#38b764',
    decor: 'pixels',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(255,255,255,0.2)',
    titleSize: 40,
    headingSize: 32,
    bodySize: 22,
    brandSize: 18,
    letterSpacing: '0.04em',
    fontWeight: 700,
    border: '4px solid #38b764',
    bulletShape: 'pixel',
  },
  'flat-vector': {
    bg: '#f4f1de',
    fg: '#1d3557',
    muted: '#457b9d',
    gradient: 'linear-gradient(135deg, #f4f1de 0%, #e9edc9 100%)',
    fontFamily: '"Vazirmatn", "Helvetica Neue", Arial, sans-serif',
    accentFallback: '#e63946',
    decor: 'shapes',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(29,53,87,0.15)',
    titleSize: 52,
    headingSize: 40,
    bodySize: 26,
    brandSize: 22,
    fontWeight: 700,
    bulletShape: 'dash',
  },
  'woodblock-print': {
    bg: '#f3e6c8',
    fg: '#2b1208',
    muted: '#5a2e16',
    gradient: 'radial-gradient(ellipse at 50% 20%, rgba(180,60,40,0.25), transparent 55%)',
    fontFamily: '"Georgia", "Vazirmatn", serif',
    accentFallback: '#8b1e1e',
    decor: 'woodblock',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.15)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 20,
    textShadow: '1px 1px 0 rgba(0,0,0,0.2)',
    bulletShape: 'dash',
  },
  'cartoon-1930s': {
    bg: '#efe6c9',
    fg: '#1a1a1a',
    muted: '#333333',
    gradient: 'radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.08), transparent 50%)',
    fontFamily: '"Courier New", "Vazirmatn", monospace',
    accentFallback: '#222222',
    decor: 'cartoon30s',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.15)',
    titleSize: 48,
    headingSize: 38,
    bodySize: 24,
    brandSize: 18,
    bulletShape: 'dot',
  },
  'brick-toy': {
    bg: '#f6e7d0',
    fg: '#1c1c1c',
    muted: '#444444',
    gradient: 'linear-gradient(180deg, #f8ecd8 0%, #e8d3b0 100%)',
    fontFamily: '"Arial Rounded MT Bold", "Vazirmatn", sans-serif',
    accentFallback: '#c1121f',
    decor: 'bricks',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.15)',
    titleSize: 52,
    headingSize: 40,
    bodySize: 26,
    brandSize: 22,
    bulletShape: 'brick',
  },
  'paper-cut': {
    bg: '#faf6ef',
    fg: '#2d2a26',
    muted: '#5c5346',
    gradient: 'linear-gradient(180deg, #fffdf8 0%, #f0e6d6 100%)',
    fontFamily: '"Georgia", "Vazirmatn", serif',
    accentFallback: '#c45c26',
    decor: 'papercut',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.12)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 20,
    bulletShape: 'dash',
  },
  'maths-diagram': {
    bg: '#ffffff',
    fg: '#0f172a',
    muted: '#334155',
    gradient: 'none',
    fontFamily: '"Times New Roman", "Vazirmatn", serif',
    accentFallback: '#0ea5e9',
    decor: 'maths',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.1)',
    titleSize: 46,
    headingSize: 36,
    bodySize: 24,
    brandSize: 18,
    bulletShape: 'dash',
  },
  'cartoon-explainer': {
    bg: '#fff7ed',
    fg: '#1c1917',
    muted: '#44403c',
    gradient: 'radial-gradient(circle at 80% 10%, rgba(251,146,60,0.35), transparent 40%)',
    fontFamily: '"Comic Sans MS", "Vazirmatn", cursive',
    accentFallback: '#ea580c',
    decor: 'cartoonExp',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.12)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 20,
    bulletShape: 'dot',
  },
  blueprint: {
    bg: '#0b3d5c',
    fg: '#d7eaf7',
    muted: 'rgba(180,210,230,0.8)',
    gradient: 'none',
    fontFamily: '"Courier New", "Vazirmatn", monospace',
    accentFallback: '#7dd3fc',
    decor: 'blueprint',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(125,211,252,0.25)',
    titleSize: 46,
    headingSize: 36,
    bodySize: 22,
    brandSize: 18,
    bulletShape: 'dash',
  },
  watercolor: {
    bg: '#f7f3ea',
    fg: '#2c2a26',
    muted: '#5a554c',
    gradient: 'radial-gradient(circle at 20% 30%, rgba(147,197,253,0.35), transparent 40%), radial-gradient(circle at 80% 70%, rgba(252,165,165,0.3), transparent 45%)',
    fontFamily: '"Georgia", "Vazirmatn", serif',
    accentFallback: '#7c3aed',
    decor: 'watercolor',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.12)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 20,
    bulletShape: 'dot',
  },
  claymation: {
    bg: '#f2d7b6',
    fg: '#3b2f2f',
    muted: '#6b5344',
    gradient: 'linear-gradient(180deg, #f6e0c4 0%, #e8c9a0 55%, #7eb6d9 55%, #7eb6d9 100%)',
    fontFamily: '"Vazirmatn", "Trebuchet MS", sans-serif',
    accentFallback: '#e11d48',
    decor: 'clay',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.15)',
    titleSize: 50,
    headingSize: 40,
    bodySize: 26,
    brandSize: 20,
    bulletShape: 'dot',
  },

};;

const THEME_ALIASES: Record<string, ClipTheme> = {
  'paper-cutout': 'paper-cut',
};

export function resolveTheme(theme: string | undefined): ClipTheme {
  const key = (theme ?? '').trim().toLowerCase();
  if ((CLIP_THEMES as readonly string[]).includes(key)) {
    return key as ClipTheme;
  }
  return THEME_ALIASES[key] ?? 'brand-dark';
}

export function resolveAccent(theme: ClipTheme, brandColor: string): string {
  const visual = THEME_VISUALS[theme];
  if (visual.lockAccent) {
    return visual.accentFallback;
  }
  return /^#([0-9a-fA-F]{6})$/.test(brandColor) ? brandColor : visual.accentFallback;
}
