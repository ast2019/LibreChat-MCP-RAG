import { appendMemoryLine, dedupeMemoryLines, normalizeMemoryLine } from './memoryLines';

describe('memory lines', () => {
  it('reads Arabic letter forms, half-spaces, bullets and closing punctuation as the same line', () => {
    expect(normalizeMemoryLine('- پاسخ‌ها كوتاه باشد.')).toBe(
      normalizeMemoryLine('پاسخ ها کوتاه باشد'),
    );
    expect(normalizeMemoryLine('  Use   Persian digits! ')).toBe('use persian digits');
  });

  it('keeps the first of repeated lines in its own wording, and one blank between paragraphs', () => {
    const value = 'Answer briefly.\n- answer briefly\n\n\nUse sources\nuse sources.\n\n';
    expect(dedupeMemoryLines(value)).toBe('Answer briefly.\n\nUse sources');
  });

  it('appends a new line and leaves a value that already holds it unchanged', () => {
    expect(appendMemoryLine(undefined, '- Disliked (inaccurate): cite sources')).toBe(
      '- Disliked (inaccurate): cite sources',
    );
    const value = 'Prefers Persian\n- Disliked (inaccurate): cite sources';
    expect(appendMemoryLine(value, '- Disliked (inaccurate): Cite sources.')).toBe(value);
    expect(appendMemoryLine(value, '- Liked (accurate_reliable): tables')).toBe(
      `${value}\n- Liked (accurate_reliable): tables`,
    );
  });
});
