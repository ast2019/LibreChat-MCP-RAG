import {
  buildFallbackTitle,
  isMissingGeneratedTitle,
  FALLBACK_TITLE_MAX_LENGTH,
} from './fallbackTitle';

describe('buildFallbackTitle', () => {
  it('returns short messages unchanged, with whitespace collapsed', () => {
    expect(buildFallbackTitle('  How do I\n\nreset my   password?  ')).toBe(
      'How do I reset my password?',
    );
  });

  it('keeps the first eight words and marks the cut', () => {
    expect(buildFallbackTitle('one two three four five six seven eight nine ten')).toBe(
      'one two three four five six seven eight…',
    );
  });

  it('caps the length at a word boundary', () => {
    const title = buildFallbackTitle(
      'Internationalization considerations for multilingual applications everywhere',
    );
    expect(title).toBe('Internationalization considerations for…');
    expect([...(title ?? '')].length).toBeLessThanOrEqual(FALLBACK_TITLE_MAX_LENGTH);
  });

  it('cuts a single overlong word', () => {
    const title = buildFallbackTitle('x'.repeat(80));
    expect(title).toBe(`${'x'.repeat(FALLBACK_TITLE_MAX_LENGTH - 1)}…`);
  });

  it('strips markdown syntax but keeps its text', () => {
    expect(buildFallbackTitle('## **Fix** the [login page](https://x.test) `bug` in my_app')).toBe(
      'Fix the login page bug in my_app',
    );
    expect(buildFallbackTitle('```js\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(buildFallbackTitle('- first item\n> quoted')).toBe('first item quoted');
  });

  it('handles non-Latin text', () => {
    expect(buildFallbackTitle('سلام، چطور می‌توانم رمزم را عوض کنم؟')).toBe(
      'سلام، چطور می‌توانم رمزم را عوض کنم؟',
    );
  });

  it('returns null when there is no usable text', () => {
    expect(buildFallbackTitle('')).toBeNull();
    expect(buildFallbackTitle('  \n ')).toBeNull();
    expect(buildFallbackTitle('**  **')).toBeNull();
    expect(buildFallbackTitle(undefined)).toBeNull();
  });
});

describe('isMissingGeneratedTitle', () => {
  it('treats empty and placeholder answers as missing', () => {
    expect(isMissingGeneratedTitle(undefined)).toBe(true);
    expect(isMissingGeneratedTitle('  ')).toBe(true);
    expect(isMissingGeneratedTitle('Untitled Conversation')).toBe(true);
    expect(isMissingGeneratedTitle('Password reset help')).toBe(false);
  });
});
