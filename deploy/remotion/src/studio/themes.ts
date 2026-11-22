import type { ThemeId } from './types';

export type BackgroundStyle = 'mesh' | 'grid' | 'paper' | 'neon';
export type AccentShape = 'rings' | 'polygons' | 'stars' | 'dots';

export interface Theme {
  id: ThemeId;
  dark: boolean;
  /** Base gradient, top to bottom */
  base: [string, string];
  /** Soft colour fields that drift in the background */
  blobs: [string, string, string];
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  /** Card fill and its border */
  surface: string;
  border: string;
  /** Text drawn on an accent fill */
  onAccent: string;
  palette: string[];
  background: BackgroundStyle;
  shape: AccentShape;
}

export const THEMES: Record<ThemeId, Theme> = {
  midnight: {
    id: 'midnight',
    dark: true,
    base: ['#0b1023', '#121a3a'],
    blobs: ['#2ea88455', '#5b5bf055', '#0ea5e944'],
    text: '#f4f6ff',
    muted: '#a9b1d6',
    accent: '#2ee6a8',
    accent2: '#7c7cff',
    surface: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.14)',
    onAccent: '#06121f',
    palette: ['#2ee6a8', '#7c7cff', '#38bdf8', '#f472b6', '#facc15', '#fb923c', '#a3e635', '#e879f9'],
    background: 'mesh',
    shape: 'rings',
  },
  aurora: {
    id: 'aurora',
    dark: true,
    base: ['#050b14', '#0b1b1f'],
    blobs: ['#10b98166', '#8b5cf655', '#06b6d455'],
    text: '#effcf6',
    muted: '#9fc5bb',
    accent: '#34d399',
    accent2: '#a78bfa',
    surface: 'rgba(16,185,129,0.08)',
    border: 'rgba(167,243,208,0.18)',
    onAccent: '#022c22',
    palette: ['#34d399', '#a78bfa', '#22d3ee', '#f0abfc', '#fde047', '#fb7185', '#4ade80', '#60a5fa'],
    background: 'mesh',
    shape: 'dots',
  },
  daylight: {
    id: 'daylight',
    dark: false,
    base: ['#f7f9fc', '#e9eef7'],
    blobs: ['#2ea88433', '#3b82f633', '#f59e0b2a'],
    text: '#0f172a',
    muted: '#475569',
    accent: '#0f9d76',
    accent2: '#2563eb',
    surface: 'rgba(255,255,255,0.85)',
    border: 'rgba(15,23,42,0.10)',
    onAccent: '#ffffff',
    palette: ['#0f9d76', '#2563eb', '#f59e0b', '#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#db2777'],
    background: 'grid',
    shape: 'polygons',
  },
  sunset: {
    id: 'sunset',
    dark: true,
    base: ['#2a0b2e', '#4a1530'],
    blobs: ['#fb923c66', '#f43f5e55', '#facc1544'],
    text: '#fff7ed',
    muted: '#fbcfe8',
    accent: '#fdba74',
    accent2: '#fb7185',
    surface: 'rgba(255,255,255,0.08)',
    border: 'rgba(255,237,213,0.2)',
    onAccent: '#3b0a1a',
    palette: ['#fdba74', '#fb7185', '#facc15', '#c084fc', '#f472b6', '#fde68a', '#fca5a5', '#a78bfa'],
    background: 'mesh',
    shape: 'stars',
  },
  editorial: {
    id: 'editorial',
    dark: false,
    base: ['#f6f1e7', '#efe6d6'],
    blobs: ['#dc262622', '#1d4ed81c', '#ca8a0420'],
    text: '#1c1917',
    muted: '#57534e',
    accent: '#dc2626',
    accent2: '#1d4ed8',
    surface: 'rgba(255,255,255,0.7)',
    border: 'rgba(28,25,23,0.14)',
    onAccent: '#ffffff',
    palette: ['#dc2626', '#1d4ed8', '#ca8a04', '#15803d', '#7c3aed', '#0f766e', '#c2410c', '#be185d'],
    background: 'paper',
    shape: 'polygons',
  },
  neon: {
    id: 'neon',
    dark: true,
    base: ['#05010d', '#0d0221'],
    blobs: ['#22d3ee44', '#e879f955', '#4f46e544'],
    text: '#f5f3ff',
    muted: '#c4b5fd',
    accent: '#22d3ee',
    accent2: '#f0abfc',
    surface: 'rgba(34,211,238,0.07)',
    border: 'rgba(34,211,238,0.35)',
    onAccent: '#020617',
    palette: ['#22d3ee', '#f0abfc', '#a3e635', '#facc15', '#fb7185', '#818cf8', '#34d399', '#fdba74'],
    background: 'neon',
    shape: 'stars',
  },
};

/** The theme with the storyboard's brand colour as its accent when one was given. */
export function themeFor(id: ThemeId, brandColor?: string): Theme {
  const theme = THEMES[id] ?? THEMES.midnight;
  if (!brandColor) {
    return theme;
  }
  return { ...theme, accent: brandColor, palette: [brandColor, ...theme.palette.slice(1)] };
}

/** `#rrggbb` + alpha (0..1) as `#rrggbbaa`. */
export function alpha(hex: string, value: number): string {
  const a = Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}
