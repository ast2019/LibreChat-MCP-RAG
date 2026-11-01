import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { WordInput } from './word';
import { buildWordDocument } from './word';
import { prepareImage } from './images';

const fontsDir = path.resolve(__dirname, '../../../../api/server/services/Office/fonts');

const ARTICLE = `## مقدمه

طبق گزارش یونسکو [۱]، **بیش از ۴۰٪** معلم‌ها از این ابزارها استفاده کرده‌اند.

## کاربردها

- طراحی آزمون
  - با پاسخ‌نامه
- بازخورد سریع

1. هدف را مشخص کنید.
2. ابزار را انتخاب کنید.

![کلاس درس](image:photo-123456)

| ابزار | کاربرد |
|---|---|
| ChatGPT | نوشتن |

> آموزش آینده ترکیبی از انسان و ماشین است.

\`\`\`chart
{"type":"column","title":"رشد","categories":["۱۴۰۳","۱۴۰۴"],"series":[{"name":"درصد","values":[25,41]}]}
\`\`\`

## چالش‌ها

حریم خصوصی.

## جمع‌بندی

پایان.`;

const base: WordInput = {
  title: 'هوش مصنوعی در آموزش',
  subtitle: 'راهنمای عملی',
  author: 'تیم HiveGPT',
  date: '۹ آبان ۱۴۰۵',
  summary: 'خلاصه‌ی مقاله.',
  keywords: ['آموزش', 'هوش مصنوعی'],
  markdown: ARTICLE,
  references: [{ title: 'هوش مصنوعی در آموزش', author: 'یونسکو', url: 'https://www.unesco.org' }],
  seo: { title: 'عنوان سئو', description: 'توضیح', slug: 'ai-education', keywords: ['آموزش'] },
  direction: 'rtl',
  accent: '1F3A5F',
  creator: 'HiveGPT',
};

async function photo() {
  return prepareImage(
    await sharp({ create: { width: 800, height: 500, channels: 3, background: '#0ea5e9' } })
      .png()
      .toBuffer(),
  );
}

async function open(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('');
  return {
    zip,
    document: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
    read,
  };
}

describe('buildWordDocument', () => {
  it('writes a right-to-left article with Word headings, lists, a table, an image and a chart', async () => {
    const result = await buildWordDocument(base, {
      images: new Map([['photo-123456', await photo()]]),
    });
    const { zip, document, styles } = await open(result.buffer);

    expect(result).toMatchObject({ sections: 4, images: 1, charts: 1, tables: 2, warnings: [] });
    expect(result.words).toBeGreaterThan(30);
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain('<w:bidiVisual/>');
    expect(document).toContain('<w:numPr>');
    expect(document).toContain('شکل ۱: کلاس درس');
    expect(document).toContain('[۱] ');
    expect(document).toContain('بسته‌ی سئو');
    /* Every paragraph of the body reads right to left, by its own setting or its style's. */
    expect(styles).toMatch(/<w:docDefaults>[\s\S]*<w:bidi\/>[\s\S]*<\/w:docDefaults>/);
    expect(styles).toContain('w:styleId="TOC1"');
    expect(Object.keys(zip.files).some((name) => /^word\/charts\/chart\d+\.xml$/.test(name))).toBe(
      true,
    );
    expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true);
  });

  it('writes a linked table of contents without page numbers and without asking to update', async () => {
    const { document } = await open((await buildWordDocument(base, { images: new Map() })).buffer);
    expect(document).toContain('TOC \\h \\n &quot;1-2&quot; \\o &quot;1-2&quot;');
    expect(document).not.toContain('w:dirty="true"');
  });

  it('embeds Vazirmatn when its files are given', async () => {
    const fonts = {
      regular: fs.readFileSync(path.join(fontsDir, 'Vazirmatn-Regular.ttf')),
      bold: fs.readFileSync(path.join(fontsDir, 'Vazirmatn-Bold.ttf')),
    };
    const { zip, read } = await open(
      (await buildWordDocument(base, { images: new Map(), fonts })).buffer,
    );
    const fontTable = await read('word/fontTable.xml');
    expect(fontTable).toContain('w:name="Vazirmatn"');
    expect(fontTable).toContain('w:embedRegular');
    expect(fontTable).toContain('w:embedBold');
    expect(Object.keys(zip.files).filter((name) => name.startsWith('word/fonts/'))).toHaveLength(2);
  });

  it('leaves out what it cannot draw and says so', async () => {
    const result = await buildWordDocument(
      {
        ...base,
        markdown:
          '![گمشده](image:missing-1234)\n\n```chart\n{"type":"pie","categories":["a"],"series":[]}\n```',
        toc: false,
        cover: false,
      },
      { images: new Map() },
    );
    expect(result.images).toBe(0);
    expect(result.charts).toBe(0);
    expect(result.warnings).toEqual([
      expect.stringContaining('"missing-1234" is not one of the user\'s images'),
      expect.stringContaining('A chart was left out: a chart needs at least one series'),
    ]);
  });

  it('writes a left-to-right document for English', async () => {
    const { document, styles } = await open(
      (
        await buildWordDocument(
          {
            ...base,
            title: 'AI in schools',
            markdown: '## Intro\n\nText with HiveGPT · 9 November.',
            references: [],
            seo: undefined,
            direction: 'ltr',
          },
          { images: new Map() },
        )
      ).buffer,
    );
    expect(styles).not.toContain('<w:bidi/>');
    expect(document).toContain('Text with HiveGPT · 9 November.');
    expect(document).not.toContain('\u200F');
  });
});
