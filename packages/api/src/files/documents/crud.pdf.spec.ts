import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { shapePersian, toVisualOrder } from '~/files/hiveOcr/fixtures.helper';
import { parseDocument } from './crud';

const mockExtractPdfPageTexts = jest.fn<Promise<string[]>, [Buffer]>();

/** pdfjs is ESM-only and cannot load under Jest's CJS runtime; the text layer is stubbed. */
jest.mock('~/files/hiveOcr/pdf', () => ({
  extractPdfPageTexts: (buffer: Buffer) => mockExtractPdfPageTexts(buffer),
}));

describe('parseDocument — PDF text is Persian-normalized', () => {
  let file: Express.Multer.File;
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crud-pdf-'));
    const filePath = path.join(dir, 'fa.pdf');
    await fs.writeFile(filePath, '%PDF-1.4 stub');
    file = {
      path: filePath,
      size: 14,
      originalname: 'fa.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File;
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('folds presentation forms, fixes reversed lines and Arabic ي/ك, joins pages', async () => {
    mockExtractPdfPageTexts.mockResolvedValueOnce([
      `${shapePersian('گزارش سالانه')}\n${toVisualOrder(shapePersian('این سطر وارونه ذخیره شده است'))}`,
      'كتاب علي',
    ]);

    const result = await parseDocument({ file });

    expect(mockExtractPdfPageTexts).toHaveBeenCalledWith(Buffer.from('%PDF-1.4 stub'));
    expect(result.text).toBe('گزارش سالانه\nاین سطر وارونه ذخیره شده است\n\nکتاب علی');
    expect(result.bytes).toBe(Buffer.byteLength(result.text, 'utf8'));
  });

  it('still reports "No text found" for a PDF without a text layer', async () => {
    mockExtractPdfPageTexts.mockResolvedValueOnce(['', ' \u200F ']);
    await expect(parseDocument({ file })).rejects.toThrow('No text found in document');
  });
});
