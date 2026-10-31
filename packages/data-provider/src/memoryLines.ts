/**
 * Line-level helpers for a memory value kept as one entry per line (the `preferences` memory
 * that feedback appends to). Shared by the client and the server so both agree on what a
 * duplicate is.
 */

/** The key feedback-learned preferences are written under. */
export const PREFERENCE_MEMORY_KEY = 'preferences';

/**
 * A line reduced to what makes it the same preference: Arabic yeh and kaf read as Persian,
 * half-spaces, tatweel and runs of whitespace as one space, list bullets and closing
 * punctuation dropped, letters lowercased.
 */
export function normalizeMemoryLine(line: string): string {
  return line
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c|\u200d|\u0640/g, ' ')
    .replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '')
    .replace(/[\s.!؟?،,;:]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The value with repeated lines removed, keeping each line's first appearance and its original
 * wording. A blank line between paragraphs stays (runs of them become one); blank lines at the
 * start and end go.
 */
export function dedupeMemoryLines(value: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const normalized = normalizeMemoryLine(line);
    if (normalized === '') {
      if (kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    kept.push(line.trimEnd());
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') {
    kept.pop();
  }
  return kept.join('\n');
}

/** `value` with `line` appended unless it already holds the same line. */
export function appendMemoryLine(value: string | null | undefined, line: string): string {
  return dedupeMemoryLines(value ? `${value}\n${line}` : line);
}
