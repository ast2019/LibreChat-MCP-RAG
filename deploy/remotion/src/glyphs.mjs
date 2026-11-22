// Glyph coverage of the bundled fonts (Vazirmatn + Inter), read from each TTF's `cmap` table.
// Used to warn when storyboard text has characters no bundled face can draw (they would fall
// back to a system font or a tofu box), and by the tests as the "missing Persian glyphs" gate.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');
export const FONT_FILES = [
  'Vazirmatn-Regular.ttf',
  'Vazirmatn-Bold.ttf',
  'Vazirmatn-Black.ttf',
  'Inter-Regular.ttf',
  'Inter-Bold.ttf',
  'InterDisplay-ExtraBold.ttf',
];

/** Code points mapped by a TrueType font's cmap (formats 4 and 12). */
export function readCmap(buffer) {
  const numTables = buffer.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (buffer.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = buffer.readUInt32BE(record + 8);
    }
  }
  if (cmapOffset < 0) {
    throw new Error('no cmap table');
  }
  const points = new Set();
  const subtables = buffer.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subtables; i += 1) {
    const offset = cmapOffset + buffer.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = buffer.readUInt16BE(offset);
    if (format === 4) {
      const segX2 = buffer.readUInt16BE(offset + 6);
      const ends = offset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s += 1) {
        const end = buffer.readUInt16BE(ends + s * 2);
        const start = buffer.readUInt16BE(starts + s * 2);
        const delta = buffer.readInt16BE(deltas + s * 2);
        const rangeOffset = buffer.readUInt16BE(rangeOffsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            const at = rangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
            glyph = buffer.readUInt16BE(at);
            glyph = glyph === 0 ? 0 : (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) {
            points.add(c);
          }
        }
      }
    } else if (format === 12) {
      const groups = buffer.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g += 1) {
        const base = offset + 16 + g * 12;
        const start = buffer.readUInt32BE(base);
        const end = buffer.readUInt32BE(base + 4);
        const glyph = buffer.readUInt32BE(base + 8);
        for (let c = start; c <= end; c += 1) {
          if (glyph + (c - start) !== 0) {
            points.add(c);
          }
        }
      }
    }
  }
  return points;
}

let coverage = null;

/** Union of the code points every bundled face maps. */
export function bundledCoverage() {
  if (!coverage) {
    coverage = new Set();
    for (const file of FONT_FILES) {
      for (const point of readCmap(readFileSync(path.join(FONT_DIR, file)))) {
        coverage.add(point);
      }
    }
  }
  return coverage;
}

/** Characters that need no glyph: whitespace, joiners, direction marks, variation selectors. */
const INVISIBLE = /[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufe00-\ufe0f]/u;
/** Emoji are drawn by the image's Noto Color Emoji, not the bundled faces. */
const EMOJI = /\p{Extended_Pictographic}/u;

/** Distinct characters in `text` that no bundled face covers (emoji excluded). */
export function missingGlyphs(text, points = bundledCoverage()) {
  const missing = new Set();
  for (const char of String(text ?? '')) {
    if (INVISIBLE.test(char) || EMOJI.test(char)) {
      continue;
    }
    if (!points.has(char.codePointAt(0))) {
      missing.add(char);
    }
  }
  return [...missing];
}
