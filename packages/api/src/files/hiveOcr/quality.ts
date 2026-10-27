export type TextQualityReason =
  | 'empty'
  | 'replacement_chars'
  | 'glyph_codes'
  | 'mojibake'
  | 'too_short';

export interface TextQuality {
  usable: boolean;
  reason?: TextQualityReason;
}

/** A page with fewer letters than this is treated as scanned (or a cover/figure) and OCR'd. */
const MIN_LETTERS = 20;
/** Share of non-space characters that may be broken glyphs before the text layer is rejected. */
const MAX_BROKEN_RATIO = 0.2;
/** Share of letters that may be Latin-1 accented before the text is considered mis-encoded. */
const MAX_LATIN1_RATIO = 0.3;

const LETTER = /\p{L}/u;
const PRIVATE_USE = /[\uE000-\uF8FF]/;
const CID_CODE = /\(cid:\d+\)|\/uni[0-9A-Fa-f]{4}/g;
/** Latin-1 letters typical of Persian fonts with custom encodings read as WinAnsi (e.g. "ÓáÇã"). */
const LATIN1_LETTER = /[\u00C0-\u00FF]/;

/**
 * Decides whether a page's text layer can be used as-is. Rejects empty pages, pages that are
 * mostly replacement characters / private-use glyphs / CID codes, mis-encoded Persian that comes
 * out as Latin-1 mojibake, and pages with too few letters to be a real text page.
 */
export function assessExtractedText(pageText: string): TextQuality {
  const trimmed = pageText.trim();
  if (!trimmed) {
    return { usable: false, reason: 'empty' };
  }

  const cidCodes = trimmed.match(CID_CODE)?.length ?? 0;
  const withoutCodes = cidCodes > 0 ? trimmed.replace(CID_CODE, '\uFFFD') : trimmed;

  let visible = 0;
  let replacement = 0;
  let privateUse = 0;
  let letters = 0;
  let latin1 = 0;
  for (const ch of withoutCodes) {
    if (/\s/.test(ch)) {
      continue;
    }
    visible++;
    if (ch === '\uFFFD') {
      replacement++;
    } else if (PRIVATE_USE.test(ch)) {
      privateUse++;
    } else if (LETTER.test(ch)) {
      letters++;
      if (LATIN1_LETTER.test(ch)) {
        latin1++;
      }
    }
  }

  if (visible > 0 && (replacement - cidCodes) / visible > MAX_BROKEN_RATIO) {
    return { usable: false, reason: 'replacement_chars' };
  }
  if (visible > 0 && (privateUse + cidCodes) / visible > MAX_BROKEN_RATIO) {
    return { usable: false, reason: 'glyph_codes' };
  }
  if (letters > 0 && latin1 / letters > MAX_LATIN1_RATIO) {
    return { usable: false, reason: 'mojibake' };
  }
  if (letters < MIN_LETTERS) {
    return { usable: false, reason: 'too_short' };
  }
  return { usable: true };
}
