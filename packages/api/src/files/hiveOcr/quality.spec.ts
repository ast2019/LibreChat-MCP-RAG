import { assessExtractedText } from './quality';

const PERSIAN_PAGE =
  'قانون اساسی جمهوری اسلامی ایران بیانگر نهادهای فرهنگی، اجتماعی، سیاسی و اقتصادی جامعه است.';

describe('assessExtractedText', () => {
  it('accepts a normal Persian page', () => {
    expect(assessExtractedText(PERSIAN_PAGE)).toEqual({ usable: true });
  });

  it('accepts a normal English page', () => {
    expect(
      assessExtractedText('The quarterly report shows revenue growth across all regions.'),
    ).toEqual({ usable: true });
  });

  it('rejects empty and whitespace-only pages', () => {
    expect(assessExtractedText('')).toEqual({ usable: false, reason: 'empty' });
    expect(assessExtractedText(' \n\t ')).toEqual({ usable: false, reason: 'empty' });
  });

  it('rejects pages that are mostly replacement characters', () => {
    expect(assessExtractedText('\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD ab\uFFFD\uFFFD')).toEqual({
      usable: false,
      reason: 'replacement_chars',
    });
  });

  it('rejects private-use glyphs and CID codes', () => {
    expect(assessExtractedText('\uE001\uE002\uE003 \uE004\uE005 متن')).toEqual({
      usable: false,
      reason: 'glyph_codes',
    });
    expect(assessExtractedText('(cid:12)(cid:45)(cid:78) (cid:9)(cid:10) ab')).toEqual({
      usable: false,
      reason: 'glyph_codes',
    });
  });

  it('rejects Persian read through a Latin-1 font encoding', () => {
    expect(assessExtractedText('ÓáÇã ÈÑ ÔãÇ ÏæÓÊÇä ÚÒíÒ ãä ÇíÑÇä ßÔæÑ ÈÒÑ')).toEqual({
      usable: false,
      reason: 'mojibake',
    });
  });

  it('keeps accented European text usable', () => {
    expect(assessExtractedText('Le café est très célèbre à Paris depuis des années.')).toEqual({
      usable: true,
    });
  });

  it('rejects pages with too few letters (page numbers, scanned pages with a header)', () => {
    expect(assessExtractedText('۱۲')).toEqual({ usable: false, reason: 'too_short' });
    expect(assessExtractedText('فصل اول — ۱۴۰۲')).toEqual({ usable: false, reason: 'too_short' });
  });

  it('tolerates a few broken glyphs in an otherwise good page', () => {
    expect(assessExtractedText(`${PERSIAN_PAGE} \uFFFD`)).toEqual({ usable: true });
  });
});
