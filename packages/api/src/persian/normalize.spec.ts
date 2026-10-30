import { normalizePersianText } from './normalize';

const Z = '\u200c';

describe('normalizePersianText', () => {
  it('turns Arabic ي and ك into Persian letters and drops kashida', () => {
    const result = normalizePersianText('كتابي خوبـــ');
    expect(result.text).toBe('کتابی خوب');
    expect(result.changes).toMatchObject({ letters: 2, kashida: 1 });
  });

  it('joins می and نمی to the verb with a half-space', () => {
    expect(normalizePersianText('من می روم و او نمی آید').text).toBe(
      `من می${Z}روم و او نمی${Z}آید`,
    );
  });

  it('does not split words that only end in می', () => {
    expect(normalizePersianText('همی شه').text).toBe('همی شه');
  });

  it('attaches ها and ترین with a half-space but leaves a separate تر alone', () => {
    expect(normalizePersianText('کتاب ها و بزرگ ترین درس های ما').text).toBe(
      `کتاب${Z}ها و بزرگ${Z}ترین درس${Z}های ما`,
    );
    expect(normalizePersianText('چشم تر').text).toBe('چشم تر');
  });

  it('uses Persian punctuation and spacing after Persian words', () => {
    expect(normalizePersianText('سلام , خوبی ? بله ; ممنون .').text).toBe(
      'سلام، خوبی؟ بله؛ ممنون.',
    );
    expect(normalizePersianText('سلام.خوبی').text).toBe('سلام. خوبی');
    expect(normalizePersianText('( سلام )').text).toBe('(سلام)');
  });

  it('quotes Persian with guillemets and leaves English quotes', () => {
    expect(normalizePersianText('گفت "سلام" و رفت').text).toBe('گفت «سلام» و رفت');
    expect(normalizePersianText('He said "hi", ok?').text).toBe('He said "hi", ok?');
  });

  it('cleans stray and doubled half-spaces and collapses inner spaces', () => {
    expect(normalizePersianText(`کتاب${Z}${Z}ها  و ${Z}دفتر`).text).toBe(`کتاب${Z}ها و دفتر`);
  });

  it('leaves code, links, emails, mentions and hashtags untouched', () => {
    const input =
      'كد `می رود ,` و ```\nكتاب ها\n``` لینک https://x.com/a?b=c,d ایمیل a.b@x.io و @علی_ها #كتاب_ها';
    const result = normalizePersianText(input);
    expect(result.text).toBe(
      'کد `می رود ,` و ```\nكتاب ها\n``` لینک https://x.com/a?b=c,d ایمیل a.b@x.io و @علی_ها #كتاب_ها',
    );
    expect(result.protectedSegments).toBe(6);
  });

  it('converts digits only when asked', () => {
    expect(normalizePersianText('سال ٢٠٢٦ و 1405').text).toBe('سال ۲۰۲۶ و 1405');
    expect(normalizePersianText('سال 1405', { digits: 'persian' }).text).toBe('سال ۱۴۰۵');
    expect(normalizePersianText('سال ۱۴۰۵ و ٢٠', { digits: 'latin' }).text).toBe('سال 1405 و 20');
  });

  it('reports no changes for clean text', () => {
    const clean = `کتاب${Z}ها را می${Z}خوانم.`;
    expect(normalizePersianText(clean)).toEqual({ text: clean, changes: {}, protectedSegments: 0 });
  });

  it('keeps decimals and English sentences as written', () => {
    expect(normalizePersianText('قیمت ۱۲.۵ دلار است').text).toBe('قیمت ۱۲.۵ دلار است');
    expect(normalizePersianText('Hello , world ?').text).toBe('Hello , world ?');
  });
});
