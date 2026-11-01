import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';

/** A piece of running text with its formatting. */
export type Inline =
  | {
      kind: 'text';
      text: string;
      bold?: boolean;
      italic?: boolean;
      strike?: boolean;
      code?: boolean;
      link?: string;
    }
  | { kind: 'break' };

export interface ListItem {
  blocks: Block[];
}

export type CellAlign = 'start' | 'center' | 'end' | null;

/** The document as the Word builder reads it, one block per paragraph-level element. */
export type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; text: string }
  | { kind: 'chart'; source: string }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][]; align: CellAlign[] }
  | { kind: 'image'; ref: string; caption: string }
  | { kind: 'rule' };

/** Raw HTML stays text; bare links become links; GFM tables and strikethrough are on. */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** Where an image in the Markdown points: `image:<file id>`, or a bare file id. */
export function imageRef(src: string): string {
  return src.replace(/^image:/i, '').trim();
}

function readInlines(token: Token | undefined): Inline[] {
  const inlines: Inline[] = [];
  const marks = { bold: 0, italic: 0, strike: 0 };
  const links: string[] = [];
  for (const child of token?.children ?? []) {
    switch (child.type) {
      case 'strong_open':
        marks.bold++;
        break;
      case 'strong_close':
        marks.bold = Math.max(0, marks.bold - 1);
        break;
      case 'em_open':
        marks.italic++;
        break;
      case 'em_close':
        marks.italic = Math.max(0, marks.italic - 1);
        break;
      case 's_open':
        marks.strike++;
        break;
      case 's_close':
        marks.strike = Math.max(0, marks.strike - 1);
        break;
      case 'link_open':
        links.push(child.attrGet('href') ?? '');
        break;
      case 'link_close':
        links.pop();
        break;
      case 'softbreak':
        inlines.push({ kind: 'text', text: ' ' });
        break;
      case 'hardbreak':
        inlines.push({ kind: 'break' });
        break;
      case 'image':
        /* An image inside a sentence keeps its caption as text; images stand on their own line. */
        if (child.content) {
          inlines.push({ kind: 'text', text: child.content });
        }
        break;
      case 'code_inline':
        inlines.push({ kind: 'text', text: child.content, code: true });
        break;
      case 'text':
      case 'html_inline': {
        if (child.content === '') {
          break;
        }
        const link = links[links.length - 1];
        inlines.push({
          kind: 'text',
          text: child.content,
          ...(marks.bold > 0 ? { bold: true } : {}),
          ...(marks.italic > 0 ? { italic: true } : {}),
          ...(marks.strike > 0 ? { strike: true } : {}),
          ...(link ? { link } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return inlines;
}

/** A paragraph made of one image, with nothing but spaces around it. */
function standaloneImage(token: Token | undefined): { ref: string; caption: string } | null {
  const children = (token?.children ?? []).filter(
    (child) =>
      !(child.type === 'text' && child.content.trim() === '') && child.type !== 'softbreak',
  );
  if (children.length !== 1 || children[0].type !== 'image') {
    return null;
  }
  const [image] = children;
  return { ref: imageRef(image.attrGet('src') ?? ''), caption: image.content.trim() };
}

function cellAlign(token: Token): CellAlign {
  const style = token.attrGet('style') ?? '';
  if (style.includes('center')) {
    return 'center';
  }
  if (style.includes('right')) {
    return 'end';
  }
  if (style.includes('left')) {
    return 'start';
  }
  return null;
}

/** Reads blocks from `tokens[start]` until the token whose type is `until`; returns the index after it. */
function readBlocks(tokens: Token[], start: number, until: string | null, out: Block[]): number {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (until != null && token.type === until) {
      return index + 1;
    }
    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.slice(1)) || 1;
        out.push({ kind: 'heading', level, inlines: readInlines(tokens[index + 1]) });
        index += 3;
        continue;
      }
      case 'paragraph_open': {
        const inline = tokens[index + 1];
        const image = standaloneImage(inline);
        if (image) {
          out.push({ kind: 'image', ...image });
        } else {
          const inlines = readInlines(inline);
          if (inlines.length > 0) {
            out.push({ kind: 'paragraph', inlines });
          }
        }
        index += 3;
        continue;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = token.type === 'ordered_list_open';
        const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
        const items: ListItem[] = [];
        let cursor = index + 1;
        while (cursor < tokens.length && tokens[cursor].type !== close) {
          if (tokens[cursor].type === 'list_item_open') {
            const blocks: Block[] = [];
            cursor = readBlocks(tokens, cursor + 1, 'list_item_close', blocks);
            items.push({ blocks });
            continue;
          }
          cursor++;
        }
        const start = Number(token.attrGet('start') ?? 1);
        out.push({ kind: 'list', ordered, start: Number.isFinite(start) ? start : 1, items });
        index = cursor + 1;
        continue;
      }
      case 'blockquote_open': {
        const blocks: Block[] = [];
        index = readBlocks(tokens, index + 1, 'blockquote_close', blocks);
        out.push({ kind: 'quote', blocks });
        continue;
      }
      case 'fence':
      case 'code_block': {
        const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (lang === 'chart') {
          out.push({ kind: 'chart', source: token.content });
        } else {
          out.push({ kind: 'code', text: token.content.replace(/\n$/, '') });
        }
        index++;
        continue;
      }
      case 'table_open': {
        const header: Inline[][] = [];
        const rows: Inline[][][] = [];
        const align: CellAlign[] = [];
        let row: Inline[][] | null = null;
        let inHead = false;
        let cursor = index + 1;
        while (cursor < tokens.length && tokens[cursor].type !== 'table_close') {
          const cell = tokens[cursor];
          if (cell.type === 'thead_open') {
            inHead = true;
          } else if (cell.type === 'thead_close') {
            inHead = false;
          } else if (cell.type === 'tr_open') {
            row = [];
          } else if (cell.type === 'tr_close' && row) {
            if (inHead) {
              header.push(...row);
            } else {
              rows.push(row);
            }
            row = null;
          } else if ((cell.type === 'th_open' || cell.type === 'td_open') && row) {
            if (inHead) {
              align.push(cellAlign(cell));
            }
            row.push(readInlines(tokens[cursor + 1]));
          }
          cursor++;
        }
        out.push({ kind: 'table', header, rows, align });
        index = cursor + 1;
        continue;
      }
      case 'hr':
        out.push({ kind: 'rule' });
        index++;
        continue;
      default:
        index++;
    }
  }
  return index;
}

/** Plain text of some inlines, for comparisons, word counts and headings in the outline. */
export function inlineText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => (inline.kind === 'text' ? inline.text : ' ')).join('');
}

const comparable = (text: string): string =>
  text
    .replace(/[\s\u200c\u200f\u200e]+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The Markdown body of a document as blocks. The headings are renumbered so the body's top
 * level is level 1, whatever the model started at, and a first heading that repeats the title is
 * dropped, since the title is already on the cover.
 */
export function parseMarkdown(source: string, title?: string): Block[] {
  const blocks: Block[] = [];
  readBlocks(md.parse(source, {}), 0, null, blocks);
  const first = blocks[0];
  if (
    title != null &&
    first?.kind === 'heading' &&
    comparable(inlineText(first.inlines)) === comparable(title)
  ) {
    blocks.shift();
  }
  const levels = blocks
    .filter((block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading')
    .map((block) => block.level);
  const top = levels.length > 0 ? Math.min(...levels) : 1;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      block.level = Math.min(3, block.level - top + 1);
    }
  }
  return blocks;
}
