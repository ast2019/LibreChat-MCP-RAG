/** Colors are six upper-case hex digits without `#`, the form Word and PowerPoint write. */

type RGB = [number, number, number];

const rgbOf = (hex: string): RGB => [
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16),
];

const hexOf = ([r, g, b]: RGB): string =>
  [r, g, b]
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

/** `from` moved toward `to` by `amount` (0 keeps it, 1 is `to`). */
export function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  return hexOf([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever reads better on the background. */
export function textOn(background: string): string {
  return contrast('FFFFFF', background) >= 4.5 ? 'FFFFFF' : '111827';
}

/** The color, lightened or darkened in small steps until it reaches the contrast asked for. */
export function withContrast(color: string, background: string, minimum: number): string {
  const toward = luminance(background) > 0.4 ? '000000' : 'FFFFFF';
  let current = color;
  for (let step = 0; step < 10 && contrast(current, background) < minimum; step++) {
    current = mix(current, toward, 0.15);
  }
  return current;
}

export type DeckStyle = 'minimal' | 'corporate' | 'education' | 'dark' | 'vibrant';

export const DECK_STYLES: readonly DeckStyle[] = [
  'minimal',
  'corporate',
  'education',
  'dark',
  'vibrant',
];

export interface DeckPalette {
  background: string;
  /** Cards and table stripes */
  surface: string;
  text: string;
  muted: string;
  /** Accent bars, numbers, the title slide's background */
  primary: string;
  /** The second color: highlights, the other side of a comparison */
  accent: string;
  /** Text on `primary` */
  onPrimary: string;
  border: string;
  /** Series colors of charts, in order */
  chart: string[];
}

const BASE: Record<DeckStyle, Omit<DeckPalette, 'onPrimary' | 'chart'>> = {
  minimal: {
    background: 'FFFFFF',
    surface: 'F4F6FA',
    text: '1F2937',
    muted: '6B7280',
    primary: '2563EB',
    accent: '0EA5E9',
    border: 'E5E7EB',
  },
  corporate: {
    background: 'FFFFFF',
    surface: 'F3F5F8',
    text: '1B2533',
    muted: '5B6573',
    primary: '1E3A5F',
    accent: 'B8901F',
    border: 'DCE2EA',
  },
  education: {
    background: 'FFFBF5',
    surface: 'FDF0DE',
    text: '2B2B2B',
    muted: '6B6458',
    primary: '0F766E',
    accent: 'E8890C',
    border: 'EFE0C8',
  },
  dark: {
    background: '0F172A',
    surface: '1E293B',
    text: 'F1F5F9',
    muted: '94A3B8',
    primary: '38BDF8',
    accent: 'A78BFA',
    border: '334155',
  },
  vibrant: {
    background: 'FFFFFF',
    surface: 'F6F2FF',
    text: '1F1B2E',
    muted: '6B6680',
    primary: '7C3AED',
    accent: 'DB2777',
    border: 'E9E3F5',
  },
};

/**
 * The colors of a deck: its style's, with the user's brand color (from their logo or asked for)
 * as the primary color. A brand color too faint to read on the slide's background is deepened,
 * and text on it is white or black, whichever is legible.
 */
export function deckPalette(
  style: DeckStyle,
  { primary, accent }: { primary?: string | null; accent?: string | null } = {},
): DeckPalette {
  const base = BASE[style];
  const chosenPrimary = withContrast(primary ?? base.primary, base.background, 3);
  const chosenAccent = withContrast(accent ?? base.accent, base.background, 3);
  return {
    ...base,
    primary: chosenPrimary,
    accent: chosenAccent,
    onPrimary: textOn(chosenPrimary),
    chart: [
      chosenPrimary,
      chosenAccent,
      mix(chosenPrimary, base.background, 0.45),
      mix(chosenAccent, base.background, 0.45),
      base.muted,
      mix(chosenPrimary, base.text, 0.45),
    ],
  };
}

export type DocumentStyle = 'formal' | 'modern' | 'academic';

/** The heading color of each Word style, before the user's own. */
export const DOCUMENT_ACCENTS: Record<DocumentStyle, string> = {
  formal: '1F3A5F',
  modern: '1D4ED8',
  academic: '1F2937',
};

/** A Word document's accent, legible as heading text on white paper. */
export function documentAccent(style: DocumentStyle, color?: string | null): string {
  return withContrast(color ?? DOCUMENT_ACCENTS[style], 'FFFFFF', 4.5);
}
