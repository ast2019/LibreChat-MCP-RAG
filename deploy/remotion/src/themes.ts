export type SceneType = 'title' | 'bullets' | 'closing';

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
  | 'orbit';

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
  'comic-art': {
    bg: '#ffe566',
    fg: '#111111',
    muted: '#222222',
    gradient: 'repeating-linear-gradient(45deg, #ffe566 0 18px, #ffd84d 18px 36px)',
    fontFamily: '"Impact", "Arial Black", "Vazirmatn", sans-serif',
    accentFallback: '#e10600',
    decor: 'halftone',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.2)',
    titleSize: 58,
    headingSize: 46,
    bodySize: 28,
    brandSize: 22,
    letterSpacing: '0.02em',
    fontWeight: 900,
    border: '6px solid #111',
    textShadow: '3px 3px 0 #fff, 5px 5px 0 #111',
    bulletShape: 'square',
  },
  'cgi-motion': {
    bg: '#070b16',
    fg: '#f2f7ff',
    muted: 'rgba(210,230,255,0.78)',
    gradient:
      'radial-gradient(circle at 20% 20%, rgba(80,140,255,0.45), transparent 42%), radial-gradient(circle at 80% 70%, rgba(180,80,255,0.35), transparent 45%)',
    fontFamily: '"Segoe UI", "Vazirmatn", system-ui, sans-serif',
    accentFallback: '#6ec8ff',
    decor: 'orbs',
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(255,255,255,0.14)',
    titleSize: 52,
    headingSize: 40,
    bodySize: 26,
    brandSize: 22,
    textShadow: '0 0 24px rgba(110,200,255,0.45)',
    bulletShape: 'dot',
  },
  lego: {
    bg: '#f4d35e',
    fg: '#1a1a1a',
    muted: '#333333',
    gradient: 'linear-gradient(180deg, #f7e08a 0%, #f0c93a 100%)',
    fontFamily: '"Arial Rounded MT Bold", "Vazirmatn", "Trebuchet MS", sans-serif',
    accentFallback: '#d62828',
    decor: 'bricks',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.18)',
    titleSize: 54,
    headingSize: 42,
    bodySize: 28,
    brandSize: 24,
    fontWeight: 800,
    bulletShape: 'brick',
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
  'zackd-films': {
    bg: '#faf7f0',
    fg: '#111111',
    muted: '#333333',
    gradient: 'none',
    fontFamily: '"Comic Sans MS", "Vazirmatn", cursive',
    accentFallback: '#111111',
    decor: 'doodle',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,0,0,0.12)',
    titleSize: 48,
    headingSize: 38,
    bodySize: 26,
    brandSize: 20,
    fontWeight: 700,
    bulletShape: 'dash',
  },
  'glow-sketch': {
    bg: '#050508',
    fg: '#e8fbff',
    muted: 'rgba(180,240,255,0.75)',
    gradient: 'radial-gradient(circle at 50% 40%, rgba(0,255,200,0.12), transparent 55%)',
    fontFamily: '"Vazirmatn", "Segoe UI", sans-serif',
    accentFallback: '#00ffc8',
    decor: 'neon',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(0,255,200,0.18)',
    titleSize: 52,
    headingSize: 40,
    bodySize: 26,
    brandSize: 22,
    textShadow: '0 0 12px #00ffc8, 0 0 28px rgba(0,255,200,0.45)',
    bulletShape: 'dot',
  },
  ps2: {
    bg: '#1b2838',
    fg: '#c7d5e0',
    muted: '#8f98a0',
    gradient: 'linear-gradient(180deg, #2a475e 0%, #1b2838 55%, #171a21 100%)',
    fontFamily: '"Tahoma", "Vazirmatn", sans-serif',
    accentFallback: '#66c0f4',
    decor: 'scanlines',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'left',
    progressTrack: 'rgba(102,192,244,0.25)',
    titleSize: 48,
    headingSize: 36,
    bodySize: 24,
    brandSize: 20,
    letterSpacing: '0.08em',
    fontWeight: 700,
    textShadow: '2px 2px 0 #000',
    bulletShape: 'square',
  },
  'dan-koe': {
    bg: '#000000',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,0.72)',
    gradient: 'none',
    fontFamily: '"Helvetica Neue", "Vazirmatn", Arial, sans-serif',
    accentFallback: '#ffffff',
    decor: 'orbit',
    lockAccent: true,
    direction: 'ltr',
    textAlign: 'center',
    progressTrack: 'rgba(255,255,255,0.15)',
    titleSize: 44,
    headingSize: 34,
    bodySize: 22,
    brandSize: 16,
    letterSpacing: '0.12em',
    fontWeight: 500,
    bulletShape: 'dot',
  },
};

export function resolveTheme(theme: string | undefined): ClipTheme {
  return (CLIP_THEMES as readonly string[]).includes(theme ?? '')
    ? (theme as ClipTheme)
    : 'brand-dark';
}

export function resolveAccent(theme: ClipTheme, brandColor: string): string {
  const visual = THEME_VISUALS[theme];
  if (visual.lockAccent) {
    return visual.accentFallback;
  }
  return /^#([0-9a-fA-F]{6})$/.test(brandColor) ? brandColor : visual.accentFallback;
}
