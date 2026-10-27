/**
 * Test fixtures: a minimal Persian shaper (base letters → positional presentation forms, as old
 * PDF producers emit them), a visual-order converter, and a tiny PDF writer.
 */
import type { PresentationPosition } from './normalize';
import { getPresentationPosition } from './normalize';

/** Letters that join only to the previous letter (never to the next). */
const RIGHT_JOINING = new Set(Array.from('اآأإدذرزژوؤةۀ'));
const ARABIC_LETTER = /[\u0621-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06C0\u06CC]/;

function buildFormTable(): Map<string, number> {
  const table = new Map<string, number>();
  for (let cp = 0xfb50; cp <= 0xfefc; cp++) {
    const position = getPresentationPosition(cp);
    if (!position) {
      continue;
    }
    const base = String.fromCodePoint(cp).normalize('NFKC');
    const key = `${base}|${position}`;
    if (!table.has(key)) {
      table.set(key, cp);
    }
  }
  return table;
}

const FORMS = buildFormTable();

function form(letter: string, position: PresentationPosition): string {
  const cp =
    FORMS.get(`${letter}|${position}`) ??
    FORMS.get(`${letter}|${position === 'medial' ? 'final' : 'isolated'}`);
  return cp ? String.fromCodePoint(cp) : letter;
}

/** Shapes Persian text into presentation forms in logical order. */
export function shapePersian(text: string): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!ARABIC_LETTER.test(ch)) {
      out += ch;
      continue;
    }
    const prev = chars[i - 1];
    const joinsPrev = prev != null && ARABIC_LETTER.test(prev) && !RIGHT_JOINING.has(prev);
    if (ch === 'ل' && chars[i + 1] === 'ا') {
      out += String.fromCodePoint(joinsPrev ? 0xfefc : 0xfefb);
      i++;
      continue;
    }
    const next = chars[i + 1];
    const joinsNext = next != null && ARABIC_LETTER.test(next) && !RIGHT_JOINING.has(ch);
    let position: PresentationPosition = 'isolated';
    if (joinsPrev && joinsNext) {
      position = 'medial';
    } else if (joinsPrev) {
      position = 'final';
    } else if (joinsNext) {
      position = 'initial';
    }
    out += form(ch, position);
  }
  return out;
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '«': '»', '»': '«' };

/**
 * Converts a logical RTL line into the visual (left-to-right glyph) order some PDFs store:
 * token order reversed, RTL tokens reversed and brackets mirrored, LTR tokens kept.
 */
export function toVisualOrder(line: string): string {
  const tokens = line.match(
    /[A-Za-z]+(?: [A-Za-z]+)*(?:[.\-/:][A-Za-z0-9]+)*|[0-9۰-۹٠-٩]+(?:[.\-/:][0-9۰-۹٠-٩]+)*|[^A-Za-z0-9۰-۹٠-٩]+/g,
  );
  return (tokens ?? [])
    .reverse()
    .map((token) =>
      /^[A-Za-z0-9۰-۹٠-٩]/.test(token)
        ? token
        : Array.from(token)
            .reverse()
            .map((ch) => MIRROR[ch] ?? ch)
            .join(''),
    )
    .join('');
}

/** Writes a valid single-font PDF; each entry is one page of Helvetica text ('' = blank page). */
export function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let id = 4;
  for (const lines of pages) {
    const pageId = id++;
    const contentId = id++;
    pageIds.push(pageId);
    const ops = lines
      .map(
        (line, index) =>
          `BT /F1 14 Tf 72 ${720 - index * 20} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`,
      )
      .join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
