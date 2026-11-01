import JSZip from 'jszip';
import sharp from 'sharp';
import { OfficeTools, OFFICE_ARTIFACT_KEY, OFFICE_FILE_CONTEXT } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { OfficeFile, OfficeToolDeps } from './tools';
import type { ServerRequest } from '~/types';
import { createOfficeTools, readBullets } from './tools';
import { getOfficeAttachments } from './attachments';

/* pptxgenjs loads `node:fs` with a dynamic import that Jest's VM refuses; the decks here carry
   only data URLs, so they are built the way a browser builds them. */
const release = process.release.name;
beforeAll(() => {
  Object.defineProperty(process.release, 'name', { value: 'jest', configurable: true });
});
afterAll(() => {
  Object.defineProperty(process.release, 'name', { value: release, configurable: true });
});

type Saved = Parameters<OfficeToolDeps['saveDocument']>[1];

function setup(officeTools: Record<string, unknown> = {}, images: Record<string, Buffer> = {}) {
  const saved: Saved[] = [];
  const deps: OfficeToolDeps = {
    saveDocument: jest.fn(async (_req, file): Promise<OfficeFile> => {
      saved.push(file);
      return {
        file_id: `file-${saved.length}`,
        filename: file.filename,
        filepath: `/uploads/u1/file-${saved.length}`,
        type: file.type,
        bytes: file.buffer.length,
        source: 'local',
        user: 'u1',
        context: file.context,
        conversationId: file.conversationId,
      };
    }),
    loadImage: jest.fn(async (_req, id: string) =>
      images[id] ? { buffer: images[id], type: 'image/png' } : null,
    ),
    loadFonts: jest.fn().mockResolvedValue(null),
    now: () => new Date('2026-10-31T12:00:00Z'),
    sleep: jest.fn().mockResolvedValue(undefined),
  };
  const req = {
    user: { id: 'u1' },
    config: { config: { officeTools } } as unknown as AppConfig,
  } as unknown as ServerRequest;
  const call = async (name: OfficeTools, args: Record<string, unknown>) => {
    const [tool] = createOfficeTools({ req, toolNames: [name] }, deps);
    const message = await tool.invoke(
      { id: 'call1', name, args, type: 'tool_call' },
      { configurable: { thread_id: 'convo1' } },
    );
    return {
      text: JSON.stringify(message.content),
      artifact: (message as unknown as { artifact: Record<string, unknown> }).artifact,
    };
  };
  return { deps, saved, call };
}

const png = (color: string) =>
  sharp({ create: { width: 400, height: 200, channels: 4, background: color } })
    .png()
    .toBuffer();

describe('create_word_document', () => {
  it('builds the file, saves it for the chat and attaches it', async () => {
    const { call, saved } = setup();
    const { text, artifact } = await call(OfficeTools.word, {
      title: 'گزارش فروش',
      markdown: '## مقدمه\n\nفروش امسال بيشتر شد.',
      version: 2,
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      filename: 'گزارش فروش - نسخه ۲.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      context: OFFICE_FILE_CONTEXT,
      conversationId: 'convo1',
    });
    expect(artifact[OFFICE_ARTIFACT_KEY]).toEqual([
      expect.objectContaining({ file_id: 'file-1', filename: 'گزارش فروش - نسخه ۲.docx' }),
    ]);
    expect(text).toContain('do not write a link');
    expect(text).toContain('version 3');

    const document = await (await JSZip.loadAsync(saved[0].buffer))
      .file('word/document.xml')!
      .async('string');
    /* Spelling is tidied like persian_normalize: the Arabic ي becomes ی. */
    expect(document).toContain('فروش امسال بیشتر شد.');
    /* The cover is dated in Tehran time, in the Solar Hijri calendar. */
    expect(document).toContain('۹ آبان ۱۴۰۵');
  });

  it("puts the user's images in and reports the ones that are not theirs", async () => {
    const { call, deps } = setup({}, { 'photo-123456': await png('#0ea5e9') });
    const { text } = await call(OfficeTools.word, {
      title: 'Report',
      markdown: '![Chart](image:photo-123456)\n\n![Other](image:not-mine-999)',
      direction: 'ltr',
    });
    expect(deps.loadImage).toHaveBeenCalledWith(expect.anything(), 'photo-123456');
    expect(text).toContain('1 images');
    expect(text).toContain('\\"not-mine-999\\" is not one of the user\'s images');
    /* A missing image is looked for again briefly, in case it is still being saved. */
    expect(deps.sleep).toHaveBeenCalled();
  });

  it('explains what is missing instead of building an empty file', async () => {
    const { call, saved } = setup({ maxDocumentChars: 1_000 });
    expect((await call(OfficeTools.word, { title: 'x', markdown: '  ' })).text).toContain(
      'needs a `title`',
    );
    expect(
      (await call(OfficeTools.word, { title: 'x', markdown: 'ب'.repeat(1_200) })).text,
    ).toContain('more than the 1000 one file takes');
    expect(saved).toHaveLength(0);
  });

  it('is unavailable when the admin turned it off', async () => {
    const { call, saved } = setup({ word: false });
    const { text } = await call(OfficeTools.word, { title: 'x', markdown: 'y' });
    expect(text).toContain('not available');
    expect(saved).toHaveLength(0);
  });
});

describe('create_presentation', () => {
  it('builds the deck with the logo and its brand color, and lists what changed', async () => {
    const { call, saved } = setup({}, { 'logo-123456': await png('#0F766E') });
    const { text, artifact } = await call(OfficeTools.slides, {
      title: 'هوش مصنوعی',
      logo_image_id: 'logo-123456',
      slides: [
        { layout: 'title' },
        { layout: 'bullets', title: 'نکته‌ها', bullets: ['یک', '- جزئیات', 'دو'] },
        { layout: 'chart', title: 'بد', chart: { type: 'pie', categories: ['a'], series: [] } },
        { layout: 'image', title: 'عکس', image_id: 'missing-123456' },
        { layout: 'comparison', title: 'تک‌ستون', columns: [{ heading: 'الف', bullets: ['۱'] }] },
      ],
    });
    expect(saved[0]).toMatchObject({ filename: 'هوش مصنوعی.pptx' });
    expect(artifact[OFFICE_ARTIFACT_KEY]).toHaveLength(1);
    expect(text).toContain('5 slides');
    expect(text).toContain('with the logo on every slide');
    expect(text).toContain('Vazirmatn');
    expect(text).toContain('Slide 3: the chart was left out');
    expect(text).toContain('Slide 4: the image missing-123456 is not one of the user');
    expect(text).toContain('Slide 5: it needs two columns');

    const zip = await JSZip.loadAsync(saved[0].buffer);
    const theme = await zip.file('ppt/slides/slide1.xml')!.async('string');
    /* The title slide is drawn in the logo's color. */
    expect(theme).toMatch(/srgbClr val="0[EF]7[67]6[DEF]"/);
  });

  it('refuses a deck longer than the deployment allows', async () => {
    const { call, saved } = setup({ maxSlides: 2 });
    const { text } = await call(OfficeTools.slides, {
      title: 'x',
      slides: [{ layout: 'title' }, { layout: 'bullets' }, { layout: 'closing' }],
    });
    expect(text).toContain('at most 2 slides');
    expect(saved).toHaveLength(0);
  });
});

describe('readBullets', () => {
  it('nests a bullet starting with "- " under the one before', () => {
    expect(readBullets(['یک', '- جزئیات', 'دو'])).toEqual([
      { text: 'یک', sub: ['جزئیات'] },
      { text: 'دو' },
    ]);
  });

  it('treats a list that is all "- " as Markdown habit, not sub-points', () => {
    expect(readBullets(['- یک', '- دو'])).toEqual([{ text: 'یک' }, { text: 'دو' }]);
  });
});

describe('getOfficeAttachments', () => {
  it('attaches the saved files to the message the run writes', () => {
    const file = {
      file_id: 'f1',
      filename: 'a.docx',
      filepath: '/uploads/u1/f1.docx',
      type: 'x',
      bytes: 3,
    };
    expect(
      getOfficeAttachments(
        { [OFFICE_ARTIFACT_KEY]: [file, { nope: true }] },
        { messageId: 'm1', toolCallId: 't1', conversationId: 'c1' },
      ),
    ).toEqual([{ ...file, messageId: 'm1', toolCallId: 't1', conversationId: 'c1' }]);
    expect(getOfficeAttachments({ content: [] }, {})).toEqual([]);
  });
});
