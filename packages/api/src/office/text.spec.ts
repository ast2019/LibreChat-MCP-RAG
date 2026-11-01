import {
  countWords,
  keepBidiOrder,
  officeFilename,
  parseHexColor,
  dominantDirection,
} from './text';

const RLM = '\u200F';

describe('keepBidiOrder', () => {
  it('keeps a Latin word, punctuation and the digits after it in reading order', () => {
    expect(keepBidiOrder('تیم HiveGPT · ۹ آبان')).toBe(`تیم HiveGPT${RLM} · ۹ آبان`);
    expect(keepBidiOrder('ChatGPT، ۲۰۲۵')).toBe(`ChatGPT${RLM}، ۲۰۲۵`);
  });

  it('leaves a version right after a name, and text without digits, as written', () => {
    expect(keepBidiOrder('مدل Gemini ۲.۵ تازه است')).toBe('مدل Gemini ۲.۵ تازه است');
    expect(keepBidiOrder('با Google Classroom کار کنید')).toBe('با Google Classroom کار کنید');
  });
});

describe('document text helpers', () => {
  it('counts words with half-spaces inside them', () => {
    expect(countWords('کتاب‌ها را می‌خوانیم و ۳ بار')).toBe(6);
    expect(countWords('  ')).toBe(0);
  });

  it('reads Persian with English terms right to left, and English left to right', () => {
    expect(dominantDirection(['هوش مصنوعی in education'])).toBe('rtl');
    expect(dominantDirection(['A guide to هوش'])).toBe('ltr');
    expect(dominantDirection(['۱۲۳'])).toBe('rtl');
  });

  it('names a file from its title, without characters file systems refuse', () => {
    expect(officeFilename('گزارش: فروش/پاییز', 'docx', { direction: 'rtl' })).toBe(
      'گزارش فروش پاییز.docx',
    );
    expect(officeFilename('هوش مصنوعی', 'pptx', { version: 2, direction: 'rtl' })).toBe(
      'هوش مصنوعی - نسخه ۲.pptx',
    );
    expect(officeFilename('Sales', 'pptx', { version: 3, direction: 'ltr' })).toBe(
      'Sales - v3.pptx',
    );
    expect(officeFilename('  ', 'docx', { direction: 'rtl' })).toBe('سند.docx');
  });

  it('reads hex colors with or without #', () => {
    expect(parseHexColor('#0f766e')).toBe('0F766E');
    expect(parseHexColor('0F766E')).toBe('0F766E');
    expect(parseHexColor('teal')).toBeNull();
    expect(parseHexColor(42)).toBeNull();
  });
});
