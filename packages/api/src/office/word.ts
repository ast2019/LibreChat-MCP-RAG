import { ChartRun } from 'docx/charts';
import {
  Table,
  Header,
  Footer,
  Packer,
  TextRun,
  Document,
  ImageRun,
  TableRow,
  PageBreak,
  Paragraph,
  TableCell,
  WidthType,
  PageNumber,
  BorderStyle,
  LevelFormat,
  ShadingType,
  CharacterSet,
  HeadingLevel,
  AlignmentType,
  TableOfContents,
  ExternalHyperlink,
} from 'docx';
import type {
  IRunOptions,
  FileChild,
  ParagraphChild,
  IParagraphOptions,
  IPropertiesOptions,
  IParagraphStylePropertiesOptions,
} from 'docx';
import type { ChartRunOptions } from 'docx/charts';
import type { Block, CellAlign, Inline, ListItem } from './markdown';
import type { PreparedImage } from './images';
import type { ChartSpec } from './charts';
import type { Direction } from './text';
import { countWords, keepBidiOrder, localDigits } from './text';
import { inlineText, parseMarkdown } from './markdown';
import { readChartSource } from './charts';

const FONT = 'Vazirmatn';
const CODE_FONT = 'Consolas';
const fontsOf = (name: string) => ({ ascii: name, hAnsi: name, cs: name, eastAsia: name });

/** A4 with 2.3 cm side margins; the content is 6.46 inches wide. */
const PAGE = { width: 11906, height: 16838, top: 1440, bottom: 1300, side: 1300 };
const CONTENT_PX = Math.floor(((PAGE.width - PAGE.side * 2) / 1440) * 96);
const MAX_IMAGE_HEIGHT_PX = 620;

const TEXT = '1F2937';
const MUTED = '6B7280';
const RULE = 'D1D5DB';
const SOFT = 'F3F4F6';

/** Half-points, the unit Word sizes text in. */
const pt = (points: number) => points * 2;

/**
 * Paragraph properties of a style, with its direction. The writer emits `bidirectional` for
 * styles as for paragraphs, but the published types list it on paragraphs only.
 */
const styleParagraph = (
  options: IParagraphStylePropertiesOptions & { bidirectional?: boolean },
): IParagraphStylePropertiesOptions => options;

export interface WordReference {
  title: string;
  author?: string;
  publisher?: string;
  date?: string;
  url?: string;
}

export interface WordSeo {
  title?: string;
  description?: string;
  slug?: string;
  keywords?: string[];
}

export interface WordInput {
  title: string;
  subtitle?: string;
  author?: string;
  /** Written as given, on the cover */
  date?: string;
  summary?: string;
  keywords?: string[];
  markdown: string;
  references?: WordReference[];
  seo?: WordSeo;
  /** A table of contents; on by default when the body has four or more top-level sections */
  toc?: boolean;
  cover?: boolean;
  direction: Direction;
  /** Heading and accent color, six hex digits */
  accent: string;
  /** Who made the file, in its properties */
  creator: string;
}

export interface WordAssets {
  /** The images the Markdown refers to, by the id in `![caption](image:<id>)` */
  images: ReadonlyMap<string, PreparedImage>;
  logo?: PreparedImage;
  /** Vazirmatn's regular and bold faces, embedded so Word shows them without installing them */
  fonts?: { regular: Buffer; bold: Buffer } | null;
}

export interface WordResult {
  buffer: Buffer;
  words: number;
  sections: number;
  images: number;
  charts: number;
  tables: number;
  /** What was left out or changed, for the model to tell the user */
  warnings: string[];
}

interface Labels {
  contents: string;
  summary: string;
  keywords: string;
  references: string;
  seo: string;
  seoTitle: string;
  seoDescription: string;
  seoSlug: string;
  seoKeywords: string;
  figure: string;
  listSeparator: string;
}

const LABELS: Record<Direction, Labels> = {
  rtl: {
    contents: 'فهرست مطالب',
    summary: 'چکیده',
    keywords: 'کلیدواژه‌ها',
    references: 'منابع',
    seo: 'بسته‌ی سئو',
    seoTitle: 'عنوان سئو',
    seoDescription: 'توضیح متا',
    seoSlug: 'نامک',
    seoKeywords: 'کلمه‌های کلیدی',
    figure: 'شکل',
    listSeparator: '، ',
  },
  ltr: {
    contents: 'Contents',
    summary: 'Abstract',
    keywords: 'Keywords',
    references: 'References',
    seo: 'SEO',
    seoTitle: 'SEO title',
    seoDescription: 'Meta description',
    seoSlug: 'Slug',
    seoKeywords: 'Keywords',
    figure: 'Figure',
    listSeparator: ', ',
  },
};

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Builds one document; holds the counters and settings every block shares. */
class WordWriter {
  readonly rtl: boolean;
  readonly labels: Labels;
  readonly warnings: string[] = [];
  images = 0;
  charts = 0;
  tables = 0;
  private listInstance = 0;

  constructor(
    readonly input: WordInput,
    readonly assets: WordAssets,
  ) {
    this.rtl = input.direction === 'rtl';
    this.labels = LABELS[input.direction];
  }

  text(value: string): string {
    return this.rtl ? keepBidiOrder(value) : value;
  }

  run(text: string, options: Omit<IRunOptions, 'text'> = {}): TextRun {
    return new TextRun({ text: this.text(text), rightToLeft: this.rtl, ...options });
  }

  paragraph(children: ParagraphChild[], options: Omit<IParagraphOptions, 'children'> = {}) {
    return new Paragraph({ bidirectional: this.rtl, children, ...options });
  }

  inlines(inlines: readonly Inline[], base: Omit<IRunOptions, 'text'> = {}): ParagraphChild[] {
    const children: ParagraphChild[] = [];
    for (const inline of inlines) {
      if (inline.kind === 'break') {
        children.push(new TextRun({ break: 1 }));
        continue;
      }
      const bold = inline.bold === true || base.bold === true;
      const options: IRunOptions = {
        ...base,
        text: inline.code ? inline.text : this.text(inline.text),
        rightToLeft: this.rtl && inline.code !== true,
        ...(bold ? { bold: true, boldComplexScript: true } : {}),
        ...(inline.italic ? { italics: true, italicsComplexScript: true } : {}),
        ...(inline.strike ? { strike: true } : {}),
        ...(inline.code
          ? {
              font: { ascii: CODE_FONT, hAnsi: CODE_FONT, cs: FONT, eastAsia: CODE_FONT },
              shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
            }
          : {}),
      };
      if (inline.link && SAFE_LINK.test(inline.link)) {
        children.push(
          new ExternalHyperlink({
            link: inline.link,
            children: [new TextRun({ ...options, style: 'Hyperlink' })],
          }),
        );
      } else {
        children.push(new TextRun(options));
      }
    }
    return children;
  }

  blocks(blocks: readonly Block[]): FileChild[] {
    const children: FileChild[] = [];
    for (const block of blocks) {
      children.push(...this.block(block));
    }
    return children;
  }

  block(block: Block): FileChild[] {
    switch (block.kind) {
      case 'heading': {
        const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
          block.level - 1
        ];
        return [this.paragraph(this.inlines(block.inlines), { heading })];
      }
      case 'paragraph':
        return [
          this.paragraph(this.inlines(block.inlines), {
            alignment: AlignmentType.BOTH,
          }),
        ];
      case 'list':
        return this.list(block, 0);
      case 'quote':
        return this.quote(block.blocks);
      case 'code':
        return this.code(block.text);
      case 'chart':
        return this.chart(block.source);
      case 'table':
        return this.table(block);
      case 'image':
        return this.image(block.ref, block.caption);
      case 'rule':
        return [
          this.paragraph([], {
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
            spacing: { before: 120, after: 240 },
          }),
        ];
      default:
        return [];
    }
  }

  list(block: Extract<Block, { kind: 'list' }>, depth: number): FileChild[] {
    const reference = block.ordered ? 'numbers' : 'bullets';
    const instance = ++this.listInstance;
    const level = Math.min(depth, 2);
    const children: FileChild[] = [];
    block.items.forEach((item: ListItem) => {
      let numbered = false;
      for (const inner of item.blocks) {
        if (inner.kind === 'paragraph' && !numbered) {
          numbered = true;
          children.push(
            this.paragraph(this.inlines(inner.inlines), {
              numbering: { reference, level, instance },
              spacing: { after: 60 },
            }),
          );
          continue;
        }
        if (inner.kind === 'list') {
          children.push(...this.list(inner, depth + 1));
          continue;
        }
        if (inner.kind === 'paragraph') {
          children.push(
            this.paragraph(this.inlines(inner.inlines), {
              indent: { start: 540 * (level + 1) },
              spacing: { after: 60 },
            }),
          );
          continue;
        }
        children.push(...this.block(inner));
      }
    });
    return children;
  }

  quote(blocks: readonly Block[]): FileChild[] {
    const paragraphs = blocks.flatMap((block) =>
      block.kind === 'paragraph' || block.kind === 'heading' ? [block.inlines] : [],
    );
    return paragraphs.map((inlines, index) =>
      this.paragraph(this.inlines(inlines, { color: '374151' }), {
        alignment: AlignmentType.CENTER,
        indent: { start: 720, end: 720 },
        shading: { type: ShadingType.CLEAR, fill: 'F9FAFB', color: 'auto' },
        border: {
          ...(index === 0
            ? { top: { style: BorderStyle.SINGLE, size: 6, color: this.input.accent, space: 6 } }
            : {}),
          ...(index === paragraphs.length - 1
            ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: this.input.accent, space: 6 } }
            : {}),
        },
        spacing: {
          before: index === 0 ? 120 : 0,
          after: index === paragraphs.length - 1 ? 240 : 0,
        },
      }),
    );
  }

  code(text: string): FileChild[] {
    const lines = text.split('\n');
    return [
      new Paragraph({
        bidirectional: false,
        alignment: AlignmentType.LEFT,
        shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
        spacing: { line: 260, after: 200 },
        children: lines.map(
          (line, index) =>
            new TextRun({
              text: line,
              break: index > 0 ? 1 : undefined,
              font: { ascii: CODE_FONT, hAnsi: CODE_FONT, cs: FONT, eastAsia: CODE_FONT },
              size: pt(9.5),
              sizeComplexScript: pt(9.5),
            }),
        ),
      }),
    ];
  }

  chart(source: string): FileChild[] {
    const result = readChartSource(source);
    if (!result.ok) {
      this.warnings.push(`A chart was left out: ${result.error}.`);
      return [];
    }
    this.charts++;
    return [
      this.paragraph([new ChartRun(this.chartOptions(result.chart))], {
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 240 },
      }),
    ];
  }

  chartOptions(chart: ChartSpec): ChartRunOptions {
    const font = { name: FONT, color: TEXT };
    const palette = [this.input.accent, '0EA5E9', 'F59E0B', '10B981', '8B5CF6', 'EF4444'];
    const title = chart.title
      ? { text: chart.title, font: { ...font, size: 13, bold: true } }
      : undefined;
    const base = {
      ...(title ? { title } : {}),
      font,
      transformation: { width: CONTENT_PX - 20, height: 330 },
      altText: { name: chart.title ?? 'chart', description: chart.title ?? '' },
    };
    if (chart.type === 'pie' || chart.type === 'doughnut') {
      const [series] = chart.series;
      return {
        ...base,
        type: chart.type,
        categories: chart.categories,
        series: [
          {
            name: series.name,
            values: series.values,
            colors: chart.categories.map((_, i) => palette[i % palette.length]),
          },
        ],
        dataLabels: { percentage: true, font: { ...font, size: 10 } },
        legend: { position: 'bottom', font: { ...font, size: 10 } },
      };
    }
    const many = chart.series.length > 1;
    return {
      ...base,
      type: chart.type,
      categories: chart.categories,
      series: chart.series.map((series, index) => ({
        name: series.name,
        values: series.values,
        color: palette[index % palette.length],
      })),
      ...(chart.stacked ? { stacking: 'stacked' as const } : {}),
      legend: many ? { position: 'bottom', font: { ...font, size: 10 } } : false,
      ...(chart.categories.length <= 12 && chart.series.length <= 3
        ? { dataLabels: { value: true, font: { ...font, size: 9 } } }
        : {}),
      categoryAxis: { font: { ...font, size: 10 } },
      valueAxis: { font: { ...font, size: 9 }, gridlines: true },
    } as ChartRunOptions;
  }

  /**
   * A table in the document's direction: the first column on the reading side, a header row in
   * the accent color that repeats on each page, and striped rows. A short table stays on one
   * page; `labels` sets the first column as row labels, as on the SEO page.
   */
  table(
    block: Extract<Block, { kind: 'table' }>,
    { labels = false }: { labels?: boolean } = {},
  ): FileChild[] {
    const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length));
    if (columns === 0) {
      return [];
    }
    this.tables++;
    const together = block.rows.length <= 10;
    const alignment = (align: CellAlign | undefined) => {
      if (align === 'center') {
        return AlignmentType.CENTER;
      }
      if (align === 'end') {
        return this.rtl ? AlignmentType.LEFT : AlignmentType.RIGHT;
      }
      return undefined;
    };
    const last = block.rows.length - 1;
    const cell = (inlines: Inline[], column: number, header: boolean, row: number) => {
      const label = labels && column === 0;
      let fill: string | undefined;
      if (header) {
        fill = this.input.accent;
      } else if (label) {
        fill = SOFT;
      } else if (row % 2 === 1) {
        fill = 'F9FAFB';
      }
      let runs: Omit<IRunOptions, 'text'> = { size: pt(10), sizeComplexScript: pt(10) };
      if (header) {
        runs = { bold: true, color: 'FFFFFF' };
      } else if (label) {
        runs = { ...runs, bold: true };
      }
      return new TableCell({
        ...(fill ? { shading: { type: ShadingType.CLEAR, fill, color: 'auto' } } : {}),
        children: [
          this.paragraph(this.inlines(inlines, runs), {
            alignment: alignment(block.align[column]),
            keepNext: together && row < last,
            spacing: { before: 0, after: 0, line: 276 },
          }),
        ],
      });
    };
    const pad = (row: Inline[][]) => Array.from({ length: columns }, (_, i) => row[i] ?? []);
    const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
    const rows: TableRow[] = [];
    if (block.header.length > 0) {
      rows.push(
        new TableRow({
          tableHeader: true,
          cantSplit: true,
          children: pad(block.header).map((inlines, i) => cell(inlines, i, true, -1)),
        }),
      );
    }
    block.rows.forEach((row, index) => {
      rows.push(
        new TableRow({
          cantSplit: true,
          children: pad(row).map((inlines, i) => cell(inlines, i, false, index)),
        }),
      );
    });
    return [
      new Table({
        rows,
        visuallyRightToLeft: this.rtl,
        width: { size: 100, type: WidthType.PERCENTAGE },
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
        borders: {
          top: border,
          bottom: border,
          left: border,
          right: border,
          insideHorizontal: border,
          insideVertical: border,
        },
      }),
      this.paragraph([], { spacing: { after: 120 } }),
    ];
  }

  imageRun(image: PreparedImage, maxWidth: number, maxHeight: number, description: string) {
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    return new ImageRun({
      type: image.type,
      data: image.data,
      transformation: {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
      },
      altText: { name: description || 'image', description, title: description },
    });
  }

  image(ref: string, caption: string): FileChild[] {
    const image = this.assets.images.get(ref);
    if (!image) {
      this.warnings.push(
        `The image "${ref}" is not one of the user's images, so it was left out${caption ? ` (caption: ${caption})` : ''}.`,
      );
      return [];
    }
    this.images++;
    const children: FileChild[] = [
      this.paragraph([this.imageRun(image, CONTENT_PX, MAX_IMAGE_HEIGHT_PX, caption)], {
        alignment: AlignmentType.CENTER,
        keepNext: caption !== '',
        spacing: { before: 120, after: caption ? 60 : 240 },
      }),
    ];
    if (caption) {
      children.push(
        this.paragraph(
          [
            this.run(
              `${this.labels.figure} ${localDigits(this.images, this.input.direction)}: ${caption}`,
            ),
          ],
          { style: 'Caption', alignment: AlignmentType.CENTER },
        ),
      );
    }
    return children;
  }

  cover(): FileChild[] {
    const { input } = this;
    const children: FileChild[] = [];
    if (this.assets.logo) {
      children.push(
        this.paragraph([this.imageRun(this.assets.logo, 180, 90, 'logo')], {
          alignment: AlignmentType.CENTER,
          spacing: { before: 1200, after: 600 },
        }),
      );
    }
    children.push(
      this.paragraph([this.run(input.title)], {
        style: 'Title',
        alignment: AlignmentType.CENTER,
        spacing: { before: this.assets.logo ? 0 : 2600, after: 240 },
      }),
    );
    if (input.subtitle) {
      children.push(
        this.paragraph([this.run(input.subtitle)], {
          style: 'Subtitle',
          alignment: AlignmentType.CENTER,
        }),
      );
    }
    children.push(
      this.paragraph([], {
        alignment: AlignmentType.CENTER,
        indent: { start: 3800, end: 3800 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: input.accent, space: 1 } },
        spacing: { before: 120, after: 480 },
      }),
    );
    for (const line of [input.author, input.date]) {
      if (line) {
        children.push(
          this.paragraph(
            [this.run(line, { color: MUTED, size: pt(12), sizeComplexScript: pt(12) })],
            {
              alignment: AlignmentType.CENTER,
              spacing: { after: 80 },
            },
          ),
        );
      }
    }
    return children;
  }

  summary(): FileChild[] {
    const { input, labels } = this;
    if (!input.summary && !input.keywords?.length) {
      return [];
    }
    const shading = { type: ShadingType.CLEAR, fill: 'F3F6FB', color: 'auto' };
    const children: FileChild[] = [
      this.paragraph(
        [this.run(labels.summary, { bold: true, boldComplexScript: true, color: input.accent })],
        {
          shading,
          border: { top: { style: BorderStyle.SINGLE, size: 18, color: input.accent, space: 8 } },
          spacing: { before: 0, after: 60 },
          indent: { start: 120, end: 120 },
        },
      ),
    ];
    if (input.summary) {
      children.push(
        this.paragraph([this.run(input.summary)], {
          shading,
          alignment: AlignmentType.BOTH,
          spacing: { after: input.keywords?.length ? 60 : 0 },
          indent: { start: 120, end: 120 },
        }),
      );
    }
    if (input.keywords?.length) {
      children.push(
        this.paragraph(
          [
            this.run(`${labels.keywords}: `, { bold: true, boldComplexScript: true }),
            this.run(input.keywords.join(labels.listSeparator), { color: MUTED }),
          ],
          { shading, indent: { start: 120, end: 120 } },
        ),
      );
    }
    children.push(this.paragraph([], { spacing: { after: 240 } }));
    return children;
  }

  references(): FileChild[] {
    const { input, labels } = this;
    if (!input.references?.length) {
      return [];
    }
    const children: FileChild[] = [
      this.paragraph([this.run(labels.references)], { heading: HeadingLevel.HEADING_1 }),
    ];
    input.references.forEach((reference, index) => {
      const parts = [
        reference.author,
        input.direction === 'rtl' ? `«${reference.title}»` : `“${reference.title}”`,
        reference.publisher,
        reference.date,
      ].filter((part): part is string => Boolean(part && part.trim()));
      const runs: ParagraphChild[] = [
        this.run(`[${localDigits(index + 1, input.direction)}] `, {
          bold: true,
          boldComplexScript: true,
        }),
        this.run(`${parts.join(labels.listSeparator)}.`),
      ];
      if (reference.url && SAFE_LINK.test(reference.url)) {
        runs.push(this.run(' '));
        runs.push(
          new ExternalHyperlink({
            link: reference.url,
            children: [
              new TextRun({ text: reference.url, style: 'Hyperlink', rightToLeft: false }),
            ],
          }),
        );
      }
      children.push(
        this.paragraph(runs, {
          indent: { start: 540, hanging: 540 },
          spacing: { after: 100 },
        }),
      );
    });
    return children;
  }

  seo(): FileChild[] {
    const { input, labels } = this;
    const seo = input.seo;
    if (!seo || !(seo.title || seo.description || seo.slug || seo.keywords?.length)) {
      return [];
    }
    const rows: Array<[string, string]> = [];
    if (seo.title) {
      rows.push([labels.seoTitle, seo.title]);
    }
    if (seo.description) {
      rows.push([labels.seoDescription, seo.description]);
    }
    if (seo.slug) {
      rows.push([labels.seoSlug, seo.slug]);
    }
    if (seo.keywords?.length) {
      rows.push([labels.seoKeywords, seo.keywords.join(labels.listSeparator)]);
    }
    const toInlines = (text: string): Inline[] => [{ kind: 'text', text }];
    return [
      this.paragraph([this.run(labels.seo)], {
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
      ...this.table(
        {
          kind: 'table',
          header: [],
          rows: rows.map(([label, value]) => [toInlines(label), toInlines(value)]),
          align: [],
        },
        { labels: true },
      ),
    ];
  }
}

/** Bullets and numbers at three levels; each list restarts its numbers through its own instance. */
function numbering(): IPropertiesOptions['numbering'] {
  const bullets = ['•', '◦', '▪'];
  const indent = (level: number) => ({ start: 540 * (level + 1), hanging: 300 });
  const font = fontsOf(FONT);
  return {
    config: [
      {
        reference: 'bullets',
        levels: bullets.map((text, level) => ({
          level,
          format: LevelFormat.BULLET,
          text,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: indent(level) }, run: { font } },
        })),
      },
      {
        reference: 'numbers',
        levels: [0, 1, 2].map((level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: indent(level) }, run: { font } },
        })),
      },
    ],
  };
}

function styles(input: WordInput): IPropertiesOptions['styles'] {
  const rtl = input.direction === 'rtl';
  const font = fontsOf(FONT);
  const language = rtl
    ? { value: 'fa-IR', bidirectional: 'fa-IR' }
    : { value: 'en-US', bidirectional: 'fa-IR' };
  const heading = (size: number, color: string, before: number, after: number) => ({
    run: {
      font,
      size: pt(size),
      sizeComplexScript: pt(size),
      bold: true,
      boldComplexScript: true,
      color,
      rightToLeft: rtl,
    },
    paragraph: { spacing: { before, after, line: 300 }, keepNext: true, keepLines: true },
  });
  return {
    default: {
      document: {
        run: {
          font,
          size: pt(11),
          sizeComplexScript: pt(11),
          color: TEXT,
          rightToLeft: rtl,
          language,
        },
        /* Right to left by default, so paragraphs the user adds in Word start that way too. */
        paragraph: styleParagraph({ bidirectional: rtl, spacing: { line: 300, after: 140 } }),
      },
      title: {
        run: {
          font,
          size: pt(28),
          sizeComplexScript: pt(28),
          bold: true,
          boldComplexScript: true,
          color: input.accent,
          rightToLeft: rtl,
        },
        paragraph: { spacing: { line: 320 } },
      },
      heading1: heading(17, input.accent, 400, 140),
      heading2: heading(14, TEXT, 280, 100),
      heading3: heading(12, input.accent, 200, 80),
      hyperlink: { run: { color: input.accent, underline: {} } },
    },
    paragraphStyles: [
      {
        id: 'Subtitle',
        name: 'Subtitle',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: pt(15), sizeComplexScript: pt(15), color: '4B5563', rightToLeft: rtl },
        paragraph: { spacing: { after: 120 } },
      },
      {
        id: 'Caption',
        name: 'caption',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: pt(9), sizeComplexScript: pt(9), color: MUTED, rightToLeft: rtl },
        paragraph: { spacing: { after: 240 } },
      },
      /* Word's own table-of-contents styles; the entries take the document's direction from them. */
      {
        id: 'TOC1',
        name: 'toc 1',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: pt(11), sizeComplexScript: pt(11), rightToLeft: rtl },
        paragraph: styleParagraph({ bidirectional: rtl, spacing: { before: 60, after: 60 } }),
      },
      {
        id: 'TOC2',
        name: 'toc 2',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: pt(10.5), sizeComplexScript: pt(10.5), color: '4B5563', rightToLeft: rtl },
        paragraph: styleParagraph({
          bidirectional: rtl,
          indent: { start: 400 },
          spacing: { before: 0, after: 40 },
        }),
      },
      {
        id: 'TocTitle',
        name: 'TOC Title',
        basedOn: 'Normal',
        next: 'Normal',
        run: {
          size: pt(17),
          sizeComplexScript: pt(17),
          bold: true,
          boldComplexScript: true,
          color: input.accent,
          rightToLeft: rtl,
        },
        paragraph: { spacing: { after: 200 } },
      },
    ],
  };
}

/** Every piece of text in the blocks, for the word count. */
function blockText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  const visit = (block: Block) => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        parts.push(inlineText(block.inlines));
        break;
      case 'list':
        block.items.forEach((item) => item.blocks.forEach(visit));
        break;
      case 'quote':
        block.blocks.forEach(visit);
        break;
      case 'table':
        [...block.header, ...block.rows.flat()].forEach((cell) => parts.push(inlineText(cell)));
        break;
      case 'image':
        parts.push(block.caption);
        break;
      default:
        break;
    }
  };
  blocks.forEach(visit);
  return parts.join(' ');
}

/**
 * A Word document from an article: a cover, an abstract box, a linked table of contents, the
 * Markdown body (headings in Word's own Heading styles, lists, tables, quotes, images with
 * captions and native charts), references and an SEO appendix. A right-to-left document is
 * right to left throughout, and embeds Vazirmatn when its files are given.
 */
export async function buildWordDocument(input: WordInput, assets: WordAssets): Promise<WordResult> {
  const writer = new WordWriter(input, assets);
  const blocks = parseMarkdown(input.markdown, input.title);
  const sections = blocks.filter((block) => block.kind === 'heading' && block.level === 1).length;
  const toc = input.toc ?? sections >= 4;
  const body: FileChild[] = [...writer.summary()];
  if (toc) {
    body.push(
      writer.paragraph([writer.run(writer.labels.contents)], { style: 'TocTitle' }),
      new TableOfContents(writer.labels.contents, {
        hyperlink: true,
        headingStyleRange: '1-2',
        pageNumbersEntryLevelsRange: '1-2',
        beginDirty: false,
      }),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }
  body.push(...writer.blocks(blocks), ...writer.references(), ...writer.seo());

  const small = { size: pt(9), sizeComplexScript: pt(9), color: '9CA3AF' };
  const header = new Header({
    children: [
      writer.paragraph([writer.run(input.title, small)], {
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB', space: 4 } },
      }),
    ],
  });
  const footer = new Footer({
    children: [
      writer.paragraph([new TextRun({ children: [PageNumber.CURRENT], ...small })], {
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
  const page = {
    size: { width: PAGE.width, height: PAGE.height },
    margin: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.side, right: PAGE.side },
  };
  const cover = input.cover !== false;
  const document = new Document({
    creator: input.creator,
    lastModifiedBy: input.creator,
    title: input.title,
    ...(input.subtitle ? { subject: input.subtitle } : {}),
    ...(input.summary ? { description: input.summary.slice(0, 250) } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords.join(', ') } : {}),
    ...(assets.fonts
      ? {
          fonts: [
            {
              name: FONT,
              data: assets.fonts.regular,
              bold: assets.fonts.bold,
              characterSet: CharacterSet.ANSI,
            },
          ],
        }
      : {}),
    styles: styles(input),
    numbering: numbering(),
    sections: [
      ...(cover ? [{ properties: { page }, children: writer.cover() }] : []),
      {
        properties: { page: { ...page, pageNumbers: { start: 1 } } },
        headers: { default: header },
        footers: { default: footer },
        children: body,
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return {
    buffer,
    words: countWords(
      [input.title, input.subtitle, input.summary, blockText(blocks)].filter(Boolean).join(' '),
    ),
    sections,
    images: writer.images,
    charts: writer.charts,
    tables: writer.tables,
    warnings: writer.warnings,
  };
}
