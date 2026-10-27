import {
  reverseVisualLine,
  isVisuallyReversed,
  normalizePersianText,
  getPresentationPosition,
} from './normalize';
import { shapePersian, toVisualOrder } from './fixtures.helper';

const ZWNJ = '\u200C';

describe('getPresentationPosition', () => {
  it('maps Forms-B and Persian Forms-A code points to their position', () => {
    expect(getPresentationPosition(0xfeb3)).toBe('initial'); // ﺳ seen initial
    expect(getPresentationPosition(0xfee0)).toBe('medial'); // ﻠ lam medial
    expect(getPresentationPosition(0xfe8e)).toBe('final'); // ﺎ alef final
    expect(getPresentationPosition(0xfee1)).toBe('isolated'); // ﻡ meem isolated
    expect(getPresentationPosition(0xfefc)).toBe('final'); // ﻼ lam-alef final
    expect(getPresentationPosition(0xfbfe)).toBe('initial'); // ﯾ farsi yeh initial
    expect(getPresentationPosition(0xfb91)).toBe('medial'); // ﮑ keheh medial
    expect(getPresentationPosition(0xfb94)).toBe('initial'); // ﮔ gaf initial
    expect(getPresentationPosition(0x0633)).toBeUndefined();
  });

  it('agrees with Unicode: every mapped form folds to one base letter', () => {
    for (let cp = 0xfe80; cp <= 0xfefc; cp++) {
      if (getPresentationPosition(cp)) {
        expect(String.fromCodePoint(cp).normalize('NFKC').length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('normalizePersianText', () => {
  it('folds presentation forms to base letters', () => {
    const shaped = shapePersian('سلام دنیا، کتابخانهٔ ملی ایران');
    expect(shaped).not.toBe('سلام دنیا، کتابخانهٔ ملی ایران');
    expect(normalizePersianText(shaped)).toBe('سلام دنیا، کتابخانهٔ ملی ایران');
  });

  it('folds hard-coded forms from a real PDF text layer', () => {
    // "پژوهشگاه" as Word-era PDFs encode it: ﭘ ﮋ ﻭ ﻫ ﺸ ﮕ ﺎ ﻩ
    expect(normalizePersianText('\uFB58\uFB8B\uFEED\uFEEB\uFEB8\uFB95\uFE8E\uFEE9')).toBe(
      'پژوهشگاه',
    );
  });

  it('maps Arabic yeh/kaf/alef maksura to Persian ی/ک', () => {
    expect(normalizePersianText('كتاب علي و مصطفى')).toBe('کتاب علی و مصطفی');
  });

  it('removes kashida, bidi controls and BOM', () => {
    expect(normalizePersianText('\uFEFF\u200Fســـلام\u202B دنـیا\u202C\u2067!\u2069')).toBe(
      'سلام دنیا!',
    );
  });

  it('keeps one ZWNJ inside words and drops stray ones', () => {
    expect(normalizePersianText(`می${ZWNJ}${ZWNJ}خواهم`)).toBe(`می${ZWNJ}خواهم`);
    expect(normalizePersianText(`کتاب${ZWNJ} ها ${ZWNJ}را`)).toBe('کتاب ها را');
    expect(normalizePersianText(`abc${ZWNJ}def`)).toBe('abcdef');
  });

  it('turns soft hyphens / zero-width spaces between Persian letters into ZWNJ', () => {
    expect(normalizePersianText('می\u00ADروم')).toBe(`می${ZWNJ}روم`);
    expect(normalizePersianText('نامه\u200Bها')).toBe(`نامه${ZWNJ}ها`);
    expect(normalizePersianText('co\u00ADoperate')).toBe('cooperate');
  });

  it('keeps the hamza-above of ezafe (ـهٔ) and Persian digits', () => {
    expect(normalizePersianText('صفحهٔ ۱۲ از ۴۵')).toBe('صفحهٔ ۱۲ از ۴۵');
  });

  it('tidies whitespace but keeps line structure', () => {
    expect(normalizePersianText('  سطر   اول\u00A0\u00A0متن  \r\nسطر دوم\n\n\n\nسطر سوم  ')).toBe(
      'سطر اول متن\nسطر دوم\n\nسطر سوم',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(normalizePersianText('')).toBe('');
    expect(normalizePersianText(' \n\t ')).toBe('');
  });
});

describe('reversed (visual order) lines', () => {
  const samples = [
    'این یک متن آزمایشی است',
    'کتابخانه ملی ایران در تهران قرار دارد',
    'گزارش سالانه شرکت پژوهش و توسعه',
    'سلام',
  ];

  it.each(samples)('restores logical order: %s', (logical) => {
    const visual = toVisualOrder(shapePersian(logical));
    expect(isVisuallyReversed(visual)).toBe(true);
    expect(normalizePersianText(visual)).toBe(logical);
  });

  it.each(samples)('leaves logically ordered shaped text alone: %s', (logical) => {
    const shaped = shapePersian(logical);
    expect(isVisuallyReversed(shaped)).toBe(false);
    expect(normalizePersianText(shaped)).toBe(logical);
  });

  it('keeps Latin and number runs in order', () => {
    const logical = 'سال 1402 نسخه GPT-4 در Hello World منتشر شد';
    const visual = toVisualOrder(shapePersian(logical));
    expect(normalizePersianText(visual)).toBe(logical);
  });

  it('keeps Persian digit dates and mirrors brackets', () => {
    const logical = 'تاریخ ۱۴۰۲/۰۵/۱۲ (جلد دوم) «نهایی» است';
    const visual = toVisualOrder(shapePersian(logical));
    expect(visual).toContain('۱۴۰۲/۰۵/۱۲');
    expect(normalizePersianText(visual)).toBe(logical);
  });

  it('fixes only the reversed lines of a page', () => {
    const page = [
      shapePersian('عنوان گزارش'),
      toVisualOrder(shapePersian('این سطر وارونه ذخیره شده است')),
      'Plain English line',
    ].join('\n');
    expect(normalizePersianText(page)).toBe(
      'عنوان گزارش\nاین سطر وارونه ذخیره شده است\nPlain English line',
    );
  });

  it('never reverses base-letter text (no positional evidence)', () => {
    const reversedBase = Array.from('این یک متن است').reverse().join('');
    expect(isVisuallyReversed(reversedBase)).toBe(false);
    expect(normalizePersianText(reversedBase)).toBe(reversedBase);
  });

  it('never reverses mostly-Latin lines', () => {
    const line = `The word ${toVisualOrder(shapePersian('سلام'))} appears in this English sentence`;
    expect(isVisuallyReversed(line)).toBe(false);
  });

  it('keeps combining marks on their letter when reversing', () => {
    // کتِاب (kasra on ت): shaped forms reversed per letter, the mark still follows its letter
    const [kaf, teh, alef, beh] = Array.from(shapePersian('کتاب'));
    const visual = `${toVisualOrder(shapePersian('خوب'))} ${beh}${alef}${teh}\u0650${kaf}`;
    expect(reverseVisualLine(visual).startsWith(`${kaf}${teh}\u0650${alef}${beh}`)).toBe(true);
    expect(normalizePersianText(visual)).toBe('کتِاب خوب');
  });
});
