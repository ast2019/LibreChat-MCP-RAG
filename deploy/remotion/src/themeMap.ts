import type React from 'react';
import { STYLES } from './animation-styles/catalog';
import {
  CgiMotionFilm,
  ComicArtFilm,
  CrtVectorFilm,
  DanKoeFilm,
  DominoRevealFilm,
  GlowSketchFilm,
  KnittedPuppetFilm,
  NoirComicFilm,
  SynthwaveFilm,
  ZackDFilmsFilm,
} from './animation-styles/styles/hivegpt/extras';

/**
 * Maps HiveGPT clip themes onto full Remotion style films.
 * Values are either a catalog id (`02-chalkboard`) or a HiveGPT extra id.
 * Brand shells stay on the text-slide composition (`null`).
 */
export const THEME_STYLE_ID: Readonly<Record<string, string | null>> = {
  'brand-dark': null,
  'brand-light': null,
  ugc: null,
  'comic-art': 'hivegpt-comic-art',
  'cgi-motion': 'hivegpt-cgi-motion',
  lego: '58-brick-toy',
  chalkboard: '02-chalkboard',
  'pixel-art': '64-pixel-art-rpg',
  'flat-vector': '17-flat-vector',
  'zackd-films': 'hivegpt-zackd-films',
  'glow-sketch': 'hivegpt-glow-sketch',
  ps2: '57-low-poly-island',
  'dan-koe': 'hivegpt-dan-koe',
  'woodblock-print': '28-woodcut',
  'noir-comic': 'hivegpt-noir-comic',
  'cartoon-1930s': '16-cel-line-boil',
  'brick-toy': '58-brick-toy',
  'clay-diorama': '62-claymation',
  'crt-vector': 'hivegpt-crt-vector',
  'knitted-puppet': 'hivegpt-knitted-puppet',
  'sumi-ink': '33-ukiyo-e',
  isometric: '39-memphis-diorama',
  'paper-cut': '24-red-papercut',
  'data-chart-3d': '52-math-diagram',
  synthwave: 'hivegpt-synthwave',
  'explainer-3d': '51-sticker-explainer',
  'maths-diagram': '52-math-diagram',
  'cartoon-explainer': '51-sticker-explainer',
  'domino-reveal': 'hivegpt-domino-reveal',
  'glow-atom': '84-hologram-hud',
  blueprint: '06-blueprint',
  mosaic: '35-stained-glass',
  watercolor: '11-watercolour',
  'threejs-3d': '57-low-poly-island',
  claymation: '62-claymation',
};

const EXTRAS: Record<string, React.FC> = {
  'hivegpt-comic-art': ComicArtFilm,
  'hivegpt-cgi-motion': CgiMotionFilm,
  'hivegpt-zackd-films': ZackDFilmsFilm,
  'hivegpt-glow-sketch': GlowSketchFilm,
  'hivegpt-dan-koe': DanKoeFilm,
  'hivegpt-noir-comic': NoirComicFilm,
  'hivegpt-crt-vector': CrtVectorFilm,
  'hivegpt-knitted-puppet': KnittedPuppetFilm,
  'hivegpt-synthwave': SynthwaveFilm,
  'hivegpt-domino-reveal': DominoRevealFilm,
};

const BY_CATALOG_ID = Object.fromEntries(STYLES.map((s) => [s.id, s.component]));
const BY_SLUG = Object.fromEntries(
  STYLES.map((s) => {
    const slug = s.id.replace(/^\d+-/, '');
    return [slug, s.component];
  }),
);

/** Resolve a theme or upstream style id/slug to a Remotion style component. */
export function resolveStyleComponent(theme: string): React.FC | null {
  const key = theme.trim().toLowerCase();
  const mapped = THEME_STYLE_ID[key];
  if (mapped === null) {
    return null;
  }
  const id = mapped ?? key;
  if (EXTRAS[id]) {
    return EXTRAS[id];
  }
  if (BY_CATALOG_ID[id]) {
    return BY_CATALOG_ID[id];
  }
  if (BY_SLUG[id]) {
    return BY_SLUG[id];
  }
  if (BY_CATALOG_ID[key] || BY_SLUG[key]) {
    return BY_CATALOG_ID[key] ?? BY_SLUG[key] ?? null;
  }
  return null;
}

export function usesStyleFilm(theme: string): boolean {
  return resolveStyleComponent(theme) != null;
}
