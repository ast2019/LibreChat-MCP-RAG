import { buildPrintDocument, detectDirection, getPdfFontUrl } from '../pdf';

describe('PDF print document', () => {
  it('lays Persian out right-to-left with the self-hosted Vazirmatn', () => {
    const html = buildPrintDocument(
      { title: 'گزارش', subtitle: 'HiveLINK · امروز', markdown: '# سلام\n\nمتن **فارسی** با 123' },
      'https://chat.example/assets/fonts/Vazirmatn-Variable.woff2',
    );
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain("url('https://chat.example/assets/fonts/Vazirmatn-Variable.woff2')");
    expect(html).toContain('<strong>فارسی</strong>');
    expect(html).toContain('<title>گزارش</title>');
  });

  it('escapes markup in the title and raw HTML in the body', () => {
    const html = buildPrintDocument(
      { title: '<img src=x onerror=alert(1)>', markdown: '<script>alert(1)</script>' },
      '/f.woff2',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
  });

  it('prints mostly-English text left-to-right', () => {
    expect(detectDirection('Hello world, سلام')).toBe('ltr');
    expect(detectDirection('سلام دنیا hello')).toBe('rtl');
  });

  it('finds the font under a subdirectory install', () => {
    expect(getPdfFontUrl('https://example.com/chat/c/new')).toBe(
      'https://example.com/chat/c/assets/fonts/Vazirmatn-Variable.woff2',
    );
    expect(getPdfFontUrl('https://example.com/chat/')).toBe(
      'https://example.com/chat/assets/fonts/Vazirmatn-Variable.woff2',
    );
  });
});
