import { toPersianDigits } from '~/persian/calendar';

export type Direction = 'rtl' | 'ltr';

const RTL_LETTER =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/**
 * The direction a document reads in from its letters: right to left once a third of them are
 * Persian (or another right-to-left script), since Persian text often carries English names and
 * terms; left to right otherwise. Right to left when there are no letters.
 */
export function dominantDirection(texts: readonly string[]): Direction {
  let rtl = 0;
  let ltr = 0;
  for (const text of texts) {
    for (const char of text) {
      if (RTL_LETTER.test(char)) {
        rtl++;
      } else if (LTR_LETTER.test(char)) {
        ltr++;
      }
    }
  }
  return rtl * 2 >= ltr ? 'rtl' : 'ltr';
}

const RLM = '\u200F';
const LATIN_BEFORE_DIGITS =
  /([A-Za-z][A-Za-z0-9]*)(?=[ \t]*[\p{P}\p{S}][ \t\p{P}\p{S}]*[0-9\u06F0-\u06F9\u0660-\u0669])/gu;

/**
 * Keeps a Latin word, punctuation and the digits after it in reading order on a right-to-left
 * line. Bidi joins the digits to the Latin word before them, so «HiveGPT · ۹ آبان» shows as
 * «۹ · HiveGPT آبان»; a right-to-left mark after the word stops that. A version right after a
 * name, as in «Gemini ۲.۵», stays as it is.
 */
export function keepBidiOrder(text: string): string {
  return text.replace(LATIN_BEFORE_DIGITS, `$1${RLM}`);
}

/** Words in a text; a half-space (ZWNJ) joins the parts of one word. */
export function countWords(text: string): number {
  const words = text.trim().split(/[\s\u200F\u200E]+/u);
  return words.filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Digits in the text's own script: Persian on a right-to-left document. */
export function localDigits(value: number | string, direction: Direction): string {
  return direction === 'rtl' ? toPersianDigits(value) : String(value);
}

/** Characters file systems refuse, and the invisible ones that would reorder the name. */
const UNSAFE_FILENAME = /[<>:"/\\|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]|\p{Cc}/gu;

/**
 * A download name from the document's title: readable, in its own language, without characters
 * file systems refuse, and with the version from the second one on.
 */
export function officeFilename(
  title: string,
  extension: 'docx' | 'pptx',
  { version, direction }: { version?: number; direction: Direction },
): string {
  const fallback = direction === 'rtl' ? 'سند' : 'document';
  const base =
    title.normalize('NFC').replace(UNSAFE_FILENAME, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) ||
    fallback;
  const versioned =
    version != null && version > 1
      ? `${base} - ${direction === 'rtl' ? `نسخه ${localDigits(version, direction)}` : `v${version}`}`
      : base;
  return `${versioned}.${extension}`;
}

/** A `#RRGGBB` or `RRGGBB` color as six upper-case hex digits; null for anything else. */
export function parseHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? match[1].toUpperCase() : null;
}
