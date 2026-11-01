import type { Block } from './markdown';
import { inlineText, parseMarkdown } from './markdown';

const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe('parseMarkdown', () => {
  it('renumbers the headings from the body top level and drops a repeated title', () => {
    const blocks = parseMarkdown('## هوش مصنوعی\n\nمتن\n\n## بخش یک\n\n### زیر بخش', 'هوش  مصنوعی');
    expect(kinds(blocks)).toEqual(['paragraph', 'heading', 'heading']);
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[2]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('keeps bold, italic, code and links as inline formatting', () => {
    const [paragraph] = parseMarkdown('متن **پررنگ** و *کج* با `npm` و [پیوند](https://x.ir)');
    expect(paragraph.kind).toBe('paragraph');
    const inlines = paragraph.kind === 'paragraph' ? paragraph.inlines : [];
    expect(inlines).toEqual(
      expect.arrayContaining([
        { kind: 'text', text: 'پررنگ', bold: true },
        { kind: 'text', text: 'کج', italic: true },
        { kind: 'text', text: 'npm', code: true },
        { kind: 'text', text: 'پیوند', link: 'https://x.ir' },
      ]),
    );
  });

  it('reads nested lists, ordered lists with their start, and tables with alignment', () => {
    const blocks = parseMarkdown(
      '- یک\n  - زیر\n- دو\n\n3. سه\n4. چهار\n\n| الف | ب |\n|---|:---:|\n| ۱ | ۲ |',
    );
    expect(kinds(blocks)).toEqual(['list', 'list', 'table']);
    const [bullets, numbers, table] = blocks;
    expect(bullets).toMatchObject({ ordered: false });
    expect(bullets.kind === 'list' && bullets.items[0].blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'list',
    ]);
    expect(numbers).toMatchObject({ ordered: true, start: 3 });
    expect(table).toMatchObject({ kind: 'table', align: [null, 'center'] });
    expect(table.kind === 'table' && table.rows[0].map(inlineText)).toEqual(['۱', '۲']);
  });

  it('takes an image on its own line, a chart block and a quote', () => {
    const blocks = parseMarkdown(
      '![کلاس درس](image:abc-123)\n\n```chart\n{"type":"bar"}\n```\n\n> نقل‌قول\n\n---',
    );
    expect(blocks).toEqual([
      { kind: 'image', ref: 'abc-123', caption: 'کلاس درس' },
      { kind: 'chart', source: '{"type":"bar"}\n' },
      {
        kind: 'quote',
        blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'نقل‌قول' }] }],
      },
      { kind: 'rule' },
    ]);
  });

  it('keeps raw HTML as text', () => {
    const [paragraph] = parseMarkdown('سلام <b>دنیا</b>');
    expect(paragraph.kind === 'paragraph' && inlineText(paragraph.inlines)).toBe(
      'سلام <b>دنیا</b>',
    );
  });
});
