import { createContext, useContext } from 'react';
import type { Theme } from './themes';
import type { AspectRatio, IconNode, Lang, AssetRef } from './types';

export interface SafeArea {
  top: number;
  bottom: number;
  start: number;
  end: number;
}

/**
 * Safe areas as fractions of the frame. 9:16 keeps the top and bottom clear of the platform
 * UI (Reels / TikTok / Shorts overlays); captions sit inside the bottom band.
 */
const SAFE: Record<AspectRatio, { top: number; bottom: number; side: number }> = {
  '9:16': { top: 0.11, bottom: 0.2, side: 0.07 },
  '4:5': { top: 0.07, bottom: 0.13, side: 0.07 },
  '1:1': { top: 0.07, bottom: 0.13, side: 0.07 },
  '16:9': { top: 0.08, bottom: 0.16, side: 0.06 },
};

export function safeArea(aspect: AspectRatio, width: number, height: number): SafeArea {
  const s = SAFE[aspect] ?? SAFE['9:16'];
  return {
    top: Math.round(height * s.top),
    bottom: Math.round(height * s.bottom),
    start: Math.round(width * s.side),
    end: Math.round(width * s.side),
  };
}

export interface Studio {
  width: number;
  height: number;
  /** 1% of the short side, the unit every size is expressed in */
  u: number;
  portrait: boolean;
  landscape: boolean;
  lang: Lang;
  rtl: boolean;
  theme: Theme;
  safe: SafeArea;
  /** The content box inside the safe area */
  box: { width: number; height: number };
  icons: Record<string, IconNode[]>;
  assets: Record<string, AssetRef>;
  fonts: { heading: string; body: string; headingWeight: number };
}

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) {
    throw new Error('useStudio outside StudioContext');
  }
  return studio;
}

export const FA_FONTS = { heading: 'Vazirmatn, Inter, sans-serif', body: 'Vazirmatn, Inter, sans-serif', headingWeight: 900 };
export const EN_FONTS = {
  heading: "'Inter Display', Inter, Vazirmatn, sans-serif",
  body: 'Inter, Vazirmatn, sans-serif',
  headingWeight: 800,
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** ASCII digits as Persian digits when the clip is Persian. */
export function localizeDigits(value: string, lang: Lang): string {
  if (lang !== 'fa') {
    return value;
  }
  return value.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Grouped number in the clip's locale (Persian digits and «٬» separators for fa). */
export function formatNumber(value: number, decimals: number, lang: Lang): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const sep = lang === 'fa' ? '٬' : ',';
  const dot = lang === 'fa' ? '٫' : '.';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const sign = value < 0 ? (lang === 'fa' ? '−' : '-') : '';
  return localizeDigits(`${sign}${grouped}${frac ? dot + frac : ''}`, lang);
}
