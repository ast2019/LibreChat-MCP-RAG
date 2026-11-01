import JSZip from 'jszip';
import sharp from 'sharp';
import type { DeckSpec } from './slides';
import { buildPresentation, fitFontSize } from './slides';
import { prepareImage } from './images';
import { deckPalette } from './theme';

/* pptxgenjs loads `node:fs` with a dynamic import that Jest's VM refuses; these decks carry
   only data URLs, so they are built the way a browser builds them. */
const release = process.release.name;
beforeAll(() => {
  Object.defineProperty(process.release, 'name', { value: 'jest', configurable: true });
});
afterAll(() => {
  Object.defineProperty(process.release, 'name', { value: release, configurable: true });
});

async function picture(color: string) {
  return prepareImage(
    await sharp({ create: { width: 900, height: 600, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

const deck = (slides: DeckSpec['slides'], extra: Partial<DeckSpec> = {}): DeckSpec => ({
  title: 'هوش مصنوعی در آموزش',
  subtitle: 'راهنمای عملی',
  author: 'تیم HiveGPT',
  date: '۹ آبان ۱۴۰۵',
  direction: 'rtl',
  palette: deckPalette('minimal'),
  creator: 'HiveGPT',
  slides,
  ...extra,
});

async function open(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const read = (name: string) => zip.file(name)!.async('string');
  return { names, read };
}

describe('buildPresentation', () => {
  it('writes every layout right to left in Vazirmatn', async () => {
    const result = await buildPresentation(
      deck([
        { layout: 'title' },
        { layout: 'agenda', title: 'دستور کار', items: [{ label: 'یک' }, { label: 'دو' }] },
        { layout: 'section', title: 'بخش اول' },
        {
          layout: 'bullets',
          title: 'نکته‌ها',
          bullets: [{ text: 'اول', sub: ['جزئیات'] }, { text: 'دوم' }],
          notes: 'یادداشت سخنران',
        },
        {
          layout: 'two_column',
          title: 'دو نگاه',
          columns: [
            { heading: 'الف', bullets: ['۱'] },
            { heading: 'ب', bullets: ['۲'] },
          ],
        },
        {
          layout: 'comparison',
          title: 'مقایسه',
          columns: [
            { heading: 'قدیم', bullets: ['کند'] },
            { heading: 'جدید', bullets: ['تند'] },
          ],
        },
        {
          layout: 'timeline',
          title: 'مسیر',
          items: [
            { label: 'مهر', text: 'شروع' },
            { label: 'آبان', text: 'اجرا' },
          ],
        },
        { layout: 'stats', title: 'عددها', items: [{ label: '۴۱٪', text: 'استفاده' }] },
        {
          layout: 'table',
          title: 'جدول',
          table: { headers: ['ستون اول', 'ستون دوم'], rows: [['الف', 'ب']] },
        },
        {
          layout: 'chart',
          title: 'نمودار',
          chart: {
            type: 'column',
            categories: ['۱۴۰۳', '۱۴۰۴'],
            series: [{ name: 'درصد', values: [25, 41] }],
          },
        },
        { layout: 'quote', quote: { text: 'جمله‌ای ماندگار', author: 'یک معلم' } },
        {
          layout: 'image',
          title: 'تصویر',
          bullets: [{ text: 'نکته' }],
          image: await picture('#0ea5e9'),
          caption: 'نمونه',
        },
        { layout: 'image_full', title: 'تمام‌صفحه', image: await picture('#1e3a8a') },
        { layout: 'closing', title: 'سپاس' },
      ]),
    );
    expect(result).toMatchObject({ slides: 14, charts: 1, images: 2, crowded: [] });
    const { names, read } = await open(result.buffer);
    expect(await read('ppt/presentation.xml')).toContain('rtl="1"');
    expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(14);
    expect(names.some((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toBe(true);
    expect(names.some((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))).toBe(true);

    const bullets = await read('ppt/slides/slide4.xml');
    expect(bullets).toContain('typeface="Vazirmatn"');
    /* Every paragraph with text carries the direction itself, bullets included; the slide
       number is a field PowerPoint fills in. */
    const paragraphs = bullets.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
    const withText = paragraphs.filter(
      (paragraph) => paragraph.includes('<a:t>') && !paragraph.includes('type="slidenum"'),
    );
    expect(withText.length).toBeGreaterThan(3);
    for (const paragraph of withText) {
      expect(paragraph).toMatch(/<a:pPr[^>]*rtl="1"/);
    }
  });

  it('puts the first table column on the right of a Persian slide', async () => {
    const result = await buildPresentation(
      deck([
        { layout: 'table', title: 'جدول', table: { headers: ['اول', 'دوم'], rows: [['۱', '۲']] } },
      ]),
    );
    const { read } = await open(result.buffer);
    const slide = await read('ppt/slides/slide1.xml');
    expect(slide.indexOf('>دوم<')).toBeLessThan(slide.indexOf('>اول<'));
  });

  it('draws the logo on the slides', async () => {
    const result = await buildPresentation(
      deck([{ layout: 'title' }, { layout: 'bullets', title: 'نکته', bullets: [{ text: 'یک' }] }], {
        logo: await picture('#0f766e'),
      }),
    );
    const { names } = await open(result.buffer);
    expect(names.filter((name) => name.startsWith('ppt/media/')).length).toBeGreaterThan(0);
  });

  it('reports slides whose text is too long even at the smallest size', async () => {
    const long = 'این یک جمله‌ی بسیار طولانی است که روی اسلاید جا نمی‌شود '.repeat(30);
    const result = await buildPresentation(
      deck([
        {
          layout: 'bullets',
          title: 'زیاد',
          bullets: Array.from({ length: 8 }, () => ({ text: long })),
        },
      ]),
    );
    expect(result.crowded).toEqual([1]);
  });

  it('writes a left-to-right deck for English', async () => {
    const result = await buildPresentation(
      deck([{ layout: 'bullets', title: 'Points', bullets: [{ text: 'One' }] }], {
        title: 'AI in schools',
        direction: 'ltr',
      }),
    );
    const { read } = await open(result.buffer);
    expect(await read('ppt/presentation.xml')).not.toContain('rtl="1"');
    expect(await read('ppt/slides/slide1.xml')).not.toContain('rtl="1"');
  });
});

describe('fitFontSize', () => {
  it('picks the largest size that fits and flags text that never does', () => {
    expect(fitFontSize([{ text: 'کوتاه' }], { w: 10, h: 4 }, [30, 20])).toEqual({
      size: 30,
      crowded: false,
    });
    expect(fitFontSize([{ text: 'ب'.repeat(5000) }], { w: 4, h: 1 }, [30, 20])).toEqual({
      size: 20,
      crowded: true,
    });
  });
});
