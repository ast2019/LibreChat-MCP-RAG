/**
 * Persian text normalization for text pulled out of PDFs (and OCR output).
 *
 * PDFs often carry Arabic Presentation Forms (positional glyph code points) instead of base
 * letters, Arabic ي/ك instead of Persian ی/ک, kashida, bidi controls, and sometimes whole lines in
 * visual (reversed) order. Lines are un-reversed first, while the positional forms still tell
 * which end of each word is which; then the forms are folded to base letters.
 */

export type PresentationPosition = 'isolated' | 'final' | 'initial' | 'medial';

const POSITIONS: readonly PresentationPosition[] = ['isolated', 'final', 'initial', 'medial'];

/** Arabic Presentation Forms-B from U+FE80: group sizes per letter (iso, fin[, ini, med]). */
const FORMS_B_GROUPS: readonly number[] = [
  1, 2, 2, 2, 2, 4, 2, 4, 2, 4, 4, 4, 4, 4, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  2, 2, 4, 2, 2, 2, 2,
];

/** Persian letters in Presentation Forms-A: [first code point, group size]. */
const FORMS_A_GROUPS: ReadonlyArray<readonly [number, number]> = [
  [0xfb50, 2], // alef wasla
  [0xfb56, 4], // peh پ
  [0xfb7a, 4], // tcheh چ
  [0xfb8a, 2], // jeh ژ
  [0xfb8e, 4], // keheh ک
  [0xfb92, 4], // gaf گ
  [0xfba4, 2], // heh with yeh above ۀ
  [0xfbfc, 4], // farsi yeh ی
];

function buildPositionTable(): Map<number, PresentationPosition> {
  const table = new Map<number, PresentationPosition>();
  let cp = 0xfe80;
  for (const size of FORMS_B_GROUPS) {
    for (let i = 0; i < size; i++) {
      table.set(cp + i, POSITIONS[i]);
    }
    cp += size;
  }
  for (const [start, size] of FORMS_A_GROUPS) {
    for (let i = 0; i < size; i++) {
      table.set(start + i, POSITIONS[i]);
    }
  }
  return table;
}

const POSITION_TABLE: Map<number, PresentationPosition> = buildPositionTable();

/** Positional variant of an Arabic presentation-form code point, if it has one. */
export function getPresentationPosition(codePoint: number): PresentationPosition | undefined {
  return POSITION_TABLE.get(codePoint);
}

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;
const ARABIC_WORD = /[\u0621-\u065F\u066E-\u06D3\u06D5\u06FA-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]+/g;
const PRESENTATION_FORM = /[\uFB50-\uFDFF\uFE70-\uFEFC]/;
const LETTER = /\p{L}/u;
const DIGIT = /^\p{Nd}/u;
const LTR_CONNECTOR = /^[.,:/\\\-_%+@#'’]$/;

/** Starts with a letter of a left-to-right script (Latin, Cyrillic, …). */
function isLtrLetter(cluster: string): boolean {
  const first = cluster.charAt(0);
  return LETTER.test(first) && !ARABIC_SCRIPT.test(first);
}

/** Clusters that keep their internal left-to-right order inside an RTL line. */
function isLtrCluster(cluster: string): boolean {
  return DIGIT.test(cluster) || isLtrLetter(cluster);
}
const CLUSTERS = /\P{M}\p{M}*|\p{M}+/gu;
const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};

interface DirectionScore {
  logical: number;
  reversed: number;
}

/**
 * Scores a line by where positional forms sit inside each Arabic-script word. In logical order a
 * word starts with an initial form and ends with a final form; a visually ordered (reversed) line
 * shows final forms at word starts and initial forms at word ends.
 */
function scoreDirection(line: string): DirectionScore {
  const score: DirectionScore = { logical: 0, reversed: 0 };
  for (const match of line.match(ARABIC_WORD) ?? []) {
    const word = Array.from(match).filter((ch) => !/\p{M}/u.test(ch));
    if (word.length < 2) {
      continue;
    }
    const first = getPresentationPosition(word[0].codePointAt(0) ?? 0);
    const last = getPresentationPosition(word[word.length - 1].codePointAt(0) ?? 0);
    if (first === 'initial') {
      score.logical++;
    } else if (first === 'final') {
      score.reversed++;
    }
    if (last === 'final') {
      score.logical++;
    } else if (last === 'initial') {
      score.reversed++;
    }
  }
  return score;
}

function isMostlyArabicScript(line: string): boolean {
  let letters = 0;
  let arabic = 0;
  for (const ch of line) {
    if (!LETTER.test(ch)) {
      continue;
    }
    letters++;
    if (ARABIC_SCRIPT.test(ch)) {
      arabic++;
    }
  }
  return letters > 0 && arabic / letters >= 0.5;
}

/** True when a line is mostly Arabic script and its positional forms show visual order. */
export function isVisuallyReversed(line: string): boolean {
  if (!PRESENTATION_FORM.test(line) || !isMostlyArabicScript(line)) {
    return false;
  }
  const { logical, reversed } = scoreDirection(line);
  return reversed > 0 && reversed > 2 * logical;
}

/**
 * Reverses a visually ordered RTL line into logical order. Combining marks stay on their base
 * letter, brackets are mirrored, and LTR runs (Latin words, numbers such as `1402/05/12`) keep
 * their internal order.
 */
export function reverseVisualLine(line: string): string {
  const clusters = line.match(CLUSTERS) ?? [];
  const ltr = clusters.map(isLtrCluster);
  for (let i = 1; i < clusters.length - 1; i++) {
    if (ltr[i] || !ltr[i - 1] || !ltr[i + 1]) {
      continue;
    }
    const cluster = clusters[i];
    if (LTR_CONNECTOR.test(cluster)) {
      ltr[i] = true;
    } else if (cluster === ' ' && isLtrLetter(clusters[i - 1]) && isLtrLetter(clusters[i + 1])) {
      ltr[i] = true;
    }
  }

  const out: string[] = [];
  let i = clusters.length - 1;
  while (i >= 0) {
    if (!ltr[i]) {
      out.push(MIRRORED[clusters[i]] ?? clusters[i]);
      i--;
      continue;
    }
    let start = i;
    while (start > 0 && ltr[start - 1]) {
      start--;
    }
    out.push(clusters.slice(start, i + 1).join(''));
    i = start - 1;
  }
  return out.join('');
}

function foldPresentationForm(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0xfeff) {
    return '';
  }
  const folded = ch.normalize('NFKC');
  /** Isolated harakat (U+FE70–U+FE7F) fold to a space + mark; keep only the mark. */
  return code >= 0xfe70 && code <= 0xfe7f ? folded.trimStart() : folded;
}

const COMPAT_FORMS = /[\uFB00-\uFDFF\uFE70-\uFEFF]/g;
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SPACE_VARIANTS = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const ARABIC_CHAR = '[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF]';
const JOINER_BETWEEN_LETTERS = new RegExp(
  `(${ARABIC_CHAR})[\\u00AD\\u200B]+(?=${ARABIC_CHAR})`,
  'g',
);
const STRAY_ZWNJ = new RegExp(`(?<!${ARABIC_CHAR})\\u200C|\\u200C(?!${ARABIC_CHAR})`, 'g');

/**
 * Normalizes Persian text: fixes visually reversed lines, folds Arabic presentation forms to base
 * letters, maps Arabic ي/ى/ك to Persian ی/ک, removes kashida and bidi controls, keeps one ZWNJ
 * (half-space) where the source had a joiner between letters, and tidies whitespace.
 */
export function normalizePersianText(text: string): string {
  if (!text) {
    return '';
  }
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (isVisuallyReversed(line) ? reverseVisualLine(line) : line));

  return lines
    .join('\n')
    .replace(COMPAT_FORMS, foldPresentationForm)
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0640/g, '')
    .replace(BIDI_CONTROLS, '')
    .replace(JOINER_BETWEEN_LETTERS, '$1\u200C')
    .replace(/[\u00AD\u200B]/g, '')
    .replace(/\u200C+/g, '\u200C')
    .replace(STRAY_ZWNJ, '')
    .replace(SPACE_VARIANTS, ' ')
    .replace(/(\S)[^\S\n]+/g, '$1 ')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
