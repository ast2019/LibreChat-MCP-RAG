import type React from 'react';
import { STYLES } from './animation-styles/catalog';

/**
 * Maps HiveGPT clip themes onto catalog Remotion style films.
 * Brand shells stay on the text-slide composition (`null`).
 * Only themes with a real upstream film are listed.
 */
export const THEME_STYLE_ID: Readonly<Record<string, string | null>> = {
  'brand-dark': null,
  'brand-light': null,
  ugc: null,
  chalkboard: '02-chalkboard',
  'pixel-art': '64-pixel-art-rpg',
  'flat-vector': '17-flat-vector',
  'woodblock-print': '28-woodcut',
  'cartoon-1930s': '16-cel-line-boil',
  'brick-toy': '58-brick-toy',
  'paper-cut': '24-red-papercut',
  'maths-diagram': '52-math-diagram',
  'cartoon-explainer': '51-sticker-explainer',
  blueprint: '06-blueprint',
  watercolor: '11-watercolour',
  claymation: '62-claymation',
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
