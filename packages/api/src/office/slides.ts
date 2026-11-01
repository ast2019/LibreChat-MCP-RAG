import PptxGenJS from 'pptxgenjs';
import type { PreparedImage } from './images';
import type { SlideLayout } from './layouts';
import type { DeckPalette } from './theme';
import type { ChartSpec } from './charts';
import type { Direction } from './text';
import { keepBidiOrder, localDigits } from './text';
import { cropToAspect } from './images';
import { mix, textOn } from './theme';

export interface SlideBullet {
  text: string;
  sub?: string[];
}

export interface SlideColumn {
  heading: string;
  bullets: string[];
}

export interface SlideItem {
  label: string;
  text?: string;
}

/** One slide, checked and with its image loaded, ready to draw. */
export interface SlideSpec {
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: SlideBullet[];
  columns?: SlideColumn[];
  items?: SlideItem[];
  table?: { headers: string[]; rows: string[][] };
  chart?: ChartSpec;
  quote?: { text: string; author?: string };
  image?: PreparedImage;
  caption?: string;
  notes?: string;
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  direction: Direction;
  palette: DeckPalette;
  slides: SlideSpec[];
  logo?: PreparedImage;
  creator: string;
}

export interface DeckResult {
  buffer: Buffer;
  slides: number;
  charts: number;
  images: number;
  /** Slides whose text needed the smallest size and may still be crowded, by number */
  crowded: number[];
}

/** The 16:9 widescreen canvas PowerPoint opens by default, in inches. */
const W = 13.333;
const H = 7.5;
const SIDE = 0.7;
const TITLE_Y = 0.42;
const TITLE_H = 0.95;
const CONTENT_Y = 1.72;
const CONTENT_H = 4.95;
const CONTENT_W = W - SIDE * 2;
const FONT = 'Vazirmatn';

/** Vazirmatn's lines are 1.71 em at single spacing; text is set at 85% of that. */
const LINE_SPACING = 0.85;
const LINE_EM = 1.71 * LINE_SPACING;
/** Average advance of a Vazirmatn glyph in em, Persian and Latin, with room for word wrapping */
const GLYPH_EM = 0.47 * 1.08;

interface FitText {
  text: string;
  /** Relative size: 1 for body lines, smaller for sub-points */
  scale?: number;
}

/**
 * The height in inches these paragraphs take in a box `width` inches wide at `size` points.
 * Widths are estimated from Vazirmatn's average glyph, with a little room left on every line.
 */
export function textHeight(
  paragraphs: readonly FitText[],
  width: number,
  size: number,
  gapPt: number,
): number {
  let height = 0;
  paragraphs.forEach((paragraph, index) => {
    const fontPt = size * (paragraph.scale ?? 1);
    const perLine = Math.max(1, (width * 72) / (fontPt * GLYPH_EM));
    const lines = Math.max(1, Math.ceil(paragraph.text.length / perLine));
    height += lines * fontPt * LINE_EM + (index > 0 ? gapPt : 0);
  });
  return height / 72;
}

/**
 * The largest of the sizes at which these paragraphs fit the box, and whether even the smallest
 * leaves them crowded.
 */
export function fitFontSize(
  paragraphs: readonly FitText[],
  box: { w: number; h: number },
  sizes: readonly number[],
  gap: number | ((size: number) => number) = 8,
): { size: number; crowded: boolean } {
  const gapAt = (size: number) => (typeof gap === 'number' ? gap : gap(size));
  for (const size of sizes) {
    if (textHeight(paragraphs, box.w, size, gapAt(size)) <= box.h) {
      return { size, crowded: false };
    }
  }
  return { size: sizes[sizes.length - 1], crowded: true };
}

/** The space after a bullet, in points, at a text size. */
const bulletGap = (size: number) => Math.round(size * 0.6);

type TextRun = PptxGenJS.TextProps;
type TextOptions = PptxGenJS.TextPropsOptions;
type Box = { x: number; y: number; w: number; h: number };

const BULLET_SIZES = [30, 28, 26, 24, 22, 20, 18, 16];
const CARD_SIZES = [26, 24, 22, 20, 18, 16];

/** Bullets as the fitter measures them: the marker's room included, sub-points smaller. */
function bulletFitText(bullets: readonly SlideBullet[]): FitText[] {
  return bullets.flatMap((bullet) => [
    { text: `•  ${bullet.text}` },
    ...(bullet.sub ?? []).map((sub) => ({ text: `   –  ${sub}`, scale: 0.82 })),
  ]);
}

class DeckWriter {
  readonly pptx = new PptxGenJS();
  readonly rtl: boolean;
  readonly palette: DeckPalette;
  readonly crowded: number[] = [];
  charts = 0;
  images = 0;
  private sectionCount = 0;
  private slideNumber = 0;

  constructor(readonly deck: DeckSpec) {
    this.rtl = deck.direction === 'rtl';
    this.palette = deck.palette;
    this.pptx.layout = 'LAYOUT_WIDE';
    this.pptx.rtlMode = this.rtl;
    this.pptx.title = deck.title;
    this.pptx.subject = deck.subtitle ?? deck.title;
    this.pptx.author = deck.author || deck.creator;
    this.pptx.company = deck.creator;
  }

  get align(): 'right' | 'left' {
    return this.rtl ? 'right' : 'left';
  }

  get endAlign(): 'right' | 'left' {
    return this.rtl ? 'left' : 'right';
  }

  /** The x of a box `width` wide that starts `fromStart` inches from the reading side's edge. */
  x(fromStart: number, width: number): number {
    return this.rtl ? W - fromStart - width : fromStart;
  }

  text(value: string): string {
    return this.rtl ? keepBidiOrder(value) : value;
  }

  base(options: TextOptions = {}): TextOptions {
    return {
      fontFace: FONT,
      lang: this.rtl ? 'fa-IR' : 'en-US',
      rtlMode: this.rtl,
      align: this.align,
      color: this.palette.text,
      margin: 0,
      valign: 'top',
      lineSpacingMultiple: LINE_SPACING,
      ...options,
    };
  }

  /** Paragraphs that each start a new line and carry the direction themselves. */
  paragraphs(lines: readonly { text: string; options?: TextOptions }[], shared: TextOptions = {}) {
    return lines.map(
      (line, index): TextRun => ({
        text: this.text(line.text),
        options: {
          ...this.base(shared),
          ...line.options,
          breakLine: index < lines.length - 1,
        },
      }),
    );
  }

  addText(slide: PptxGenJS.Slide, text: string, box: Box, options: TextOptions = {}) {
    slide.addText(this.text(text), { ...this.base(options), ...box });
  }

  fit(
    slideIndex: number,
    paragraphs: readonly FitText[],
    box: { w: number; h: number },
    sizes: readonly number[],
    gap?: number | ((size: number) => number),
  ) {
    const fitted = fitFontSize(paragraphs, box, sizes, gap);
    if (fitted.crowded) {
      this.markCrowded(slideIndex);
    }
    return fitted.size;
  }

  /** Reports a slide, by its number, whose text is too long even at the smallest size. */
  markCrowded(slideIndex: number) {
    if (!this.crowded.includes(slideIndex + 1)) {
      this.crowded.push(slideIndex + 1);
    }
  }

  newSlide(spec: SlideSpec, background = this.palette.background) {
    const slide = this.pptx.addSlide();
    slide.background = { color: background };
    this.slideNumber++;
    if (spec.notes) {
      slide.addNotes(spec.notes);
    }
    return slide;
  }

  logo(slide: PptxGenJS.Slide, box: Box, onColor = false) {
    const logo = this.deck.logo;
    if (!logo) {
      return;
    }
    const scale = Math.min(box.w / logo.width, box.h / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const x = this.rtl ? box.x : box.x + box.w - w;
    if (onColor) {
      slide.addShape('roundRect', {
        x: x - 0.12,
        y: box.y - 0.08,
        w: w + 0.24,
        h: h + 0.16,
        fill: { color: 'FFFFFF' },
        line: { color: 'FFFFFF' },
        rectRadius: 0.08,
      });
    }
    slide.addImage({ data: dataUrl(logo), x, y: box.y, w, h });
  }

  /** Title, accent bar, logo, footer and slide number of a content slide. */
  chrome(slide: PptxGenJS.Slide, spec: SlideSpec, index: number) {
    const { palette } = this;
    const logoW = this.deck.logo ? 1.5 : 0;
    const titleW = CONTENT_W - logoW - (logoW ? 0.3 : 0);
    if (spec.title) {
      const size = this.fit(
        index,
        [{ text: spec.title }],
        { w: titleW, h: TITLE_H },
        [32, 28, 24, 22],
      );
      this.addText(
        slide,
        spec.title,
        { x: this.x(SIDE, titleW), y: TITLE_Y, w: titleW, h: TITLE_H },
        {
          fontSize: size,
          bold: true,
          valign: 'middle',
          color: palette.text,
        },
      );
    }
    slide.addShape('rect', {
      x: this.x(SIDE, 1.1),
      y: TITLE_Y + TITLE_H + 0.06,
      w: 1.1,
      h: 0.07,
      fill: { color: palette.primary },
      line: { color: palette.primary, width: 0 },
    });
    this.logo(slide, { x: this.x(W - SIDE - logoW, logoW), y: TITLE_Y + 0.17, w: logoW, h: 0.6 });
    this.addText(
      slide,
      this.deck.title,
      { x: this.x(SIDE, 8), y: H - 0.5, w: 8, h: 0.3 },
      {
        fontSize: 10,
        color: palette.muted,
        valign: 'middle',
      },
    );
    slide.slideNumber = {
      x: this.x(W - SIDE - 0.8, 0.8),
      y: H - 0.5,
      w: 0.8,
      h: 0.3,
      fontFace: FONT,
      fontSize: 10,
      color: palette.muted,
      align: this.endAlign,
    };
  }

  bulletLines(bullets: readonly SlideBullet[], size: number, color = this.palette.text) {
    const lines: { text: string; options?: TextOptions }[] = [];
    for (const bullet of bullets) {
      lines.push({
        text: bullet.text,
        options: {
          fontSize: size,
          color,
          bullet: { indent: Math.round(size * 1.1) },
          paraSpaceAfter: bulletGap(size),
        },
      });
      for (const sub of bullet.sub ?? []) {
        lines.push({
          text: sub,
          options: {
            fontSize: Math.round(size * 0.82),
            color: this.palette.muted,
            bullet: { indent: Math.round(size * 0.9), characterCode: '2013' },
            indentLevel: 1,
            paraSpaceAfter: Math.round(size * 0.35),
          },
        });
      }
    }
    return lines;
  }

  bullets(
    slide: PptxGenJS.Slide,
    index: number,
    bullets: readonly SlideBullet[],
    box: Box,
    sizes: readonly number[] = BULLET_SIZES,
  ) {
    const size = this.fit(index, bulletFitText(bullets), box, sizes, bulletGap);
    slide.addText(this.paragraphs(this.bulletLines(bullets, size)), { ...this.base(), ...box });
  }

  titleSlide(spec: SlideSpec, closing = false) {
    const { palette, deck } = this;
    const slide = this.newSlide(spec, palette.primary);
    const soft = mix(palette.onPrimary, palette.primary, 0.25);
    slide.addShape('ellipse', {
      x: this.x(W - 3.6, 5.2),
      y: -1.9,
      w: 5.2,
      h: 5.2,
      fill: { color: palette.onPrimary, transparency: 92 },
      line: { color: palette.onPrimary, transparency: 100, width: 0 },
    });
    slide.addShape('ellipse', {
      x: this.x(W - 1.6, 2.6),
      y: H - 2.0,
      w: 2.6,
      h: 2.6,
      fill: { color: palette.accent, transparency: 70 },
      line: { color: palette.accent, transparency: 100, width: 0 },
    });
    const title = spec.title ?? deck.title;
    const width = closing ? CONTENT_W : 9.6;
    const align = closing ? 'center' : this.align;
    const x = closing ? SIDE : this.x(SIDE + 0.3, width);
    const size = this.fit(
      this.slideNumber - 1,
      [{ text: title }],
      { w: width, h: 2.0 },
      [48, 44, 40, 36, 32],
    );
    const top = closing ? 2.4 : 2.15;
    this.addText(
      slide,
      title,
      { x, y: top, w: width, h: 2.0 },
      {
        fontSize: size,
        bold: true,
        color: palette.onPrimary,
        valign: 'bottom',
        align,
      },
    );
    slide.addShape('rect', {
      x: closing ? (W - 1.4) / 2 : this.x(SIDE + 0.3, 1.4),
      y: top + 2.18,
      w: 1.4,
      h: 0.08,
      fill: { color: palette.accent },
      line: { color: palette.accent, width: 0 },
    });
    const subtitle = spec.subtitle ?? (closing ? undefined : deck.subtitle);
    if (subtitle) {
      this.addText(
        slide,
        subtitle,
        { x, y: top + 2.45, w: width, h: 0.9 },
        {
          fontSize: 22,
          color: soft,
          align,
        },
      );
    }
    const meta = [spec.body ?? (closing ? undefined : deck.author), closing ? undefined : deck.date]
      .filter((part): part is string => Boolean(part))
      .join('  ·  ');
    if (meta) {
      this.addText(
        slide,
        meta,
        { x, y: top + (subtitle ? 3.35 : 2.5), w: width, h: 0.5 },
        {
          fontSize: 15,
          color: soft,
          align,
        },
      );
    }
    this.logo(slide, { x: this.x(W - SIDE - 1.6, 1.6), y: 0.55, w: 1.6, h: 0.7 }, true);
  }

  sectionSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec, mix(palette.primary, palette.background, 0.9));
    this.sectionCount++;
    slide.addShape('rect', {
      x: this.x(0, 0.28),
      y: 0,
      w: 0.28,
      h: H,
      fill: { color: palette.primary },
      line: { color: palette.primary, width: 0 },
    });
    const number = localDigits(String(this.sectionCount).padStart(2, '0'), this.deck.direction);
    this.addText(
      slide,
      number,
      { x: this.x(SIDE + 0.4, 3), y: 1.6, w: 3, h: 1.5 },
      {
        fontSize: 80,
        bold: true,
        color: palette.primary,
        valign: 'bottom',
      },
    );
    const title = spec.title ?? '';
    const size = this.fit(index, [{ text: title }], { w: 10.5, h: 1.6 }, [44, 40, 36, 32, 28]);
    this.addText(
      slide,
      title,
      { x: this.x(SIDE + 0.4, 10.5), y: 3.2, w: 10.5, h: 1.6 },
      {
        fontSize: size,
        bold: true,
        color: palette.text,
      },
    );
    if (spec.subtitle) {
      this.addText(
        slide,
        spec.subtitle,
        { x: this.x(SIDE + 0.4, 10.5), y: 4.85, w: 10.5, h: 0.9 },
        {
          fontSize: 20,
          color: palette.muted,
        },
      );
    }
    this.logo(slide, { x: this.x(W - SIDE - 1.5, 1.5), y: 0.55, w: 1.5, h: 0.6 });
  }

  agendaSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const entries = (
      spec.items?.length
        ? spec.items.map((item) => item.label)
        : (spec.bullets ?? []).map((bullet) => bullet.text)
    ).slice(0, 12);
    const columns = entries.length > 6 ? 2 : 1;
    const perColumn = Math.ceil(entries.length / columns);
    const gap = 0.6;
    const columnW = (CONTENT_W - gap * (columns - 1)) / columns;
    const rowH = Math.min(1.0, CONTENT_H / Math.max(perColumn, 1));
    const circle = Math.min(0.62, rowH * 0.72);
    const textW = columnW - circle - 0.35;
    const size = Math.min(
      ...entries.map((text) =>
        this.fit(index, [{ text }], { w: textW, h: rowH * 0.92 }, [28, 26, 24, 22, 20, 18, 16]),
      ),
    );
    const top = CONTENT_Y + (CONTENT_H - rowH * perColumn) / 2;
    entries.forEach((entry, i) => {
      const column = Math.floor(i / perColumn);
      const row = i % perColumn;
      const start = SIDE + column * (columnW + gap);
      const y = top + row * rowH;
      const tone = i % 2 === 0 ? palette.primary : palette.accent;
      slide.addShape('ellipse', {
        x: this.x(start, circle),
        y: y + (rowH - circle) / 2,
        w: circle,
        h: circle,
        fill: { color: tone },
        line: { color: tone, width: 0 },
      });
      this.addText(
        slide,
        localDigits(i + 1, this.deck.direction),
        { x: this.x(start, circle), y: y + (rowH - circle) / 2, w: circle, h: circle },
        { fontSize: 18, bold: true, color: textOn(tone), align: 'center', valign: 'middle' },
      );
      this.addText(
        slide,
        entry,
        { x: this.x(start + circle + 0.35, textW), y, w: textW, h: rowH },
        {
          fontSize: size,
          valign: 'middle',
        },
      );
      if (row < perColumn - 1 && i < entries.length - 1) {
        slide.addShape('rect', {
          x: this.x(start + circle + 0.35, textW),
          y: y + rowH - 0.01,
          w: textW,
          h: 0.01,
          fill: { color: palette.border },
          line: { color: palette.border, width: 0 },
        });
      }
    });
  }

  bulletsSlide(spec: SlideSpec, index: number) {
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const bullets = spec.bullets ?? [];
    let top = CONTENT_Y + 0.1;
    if (spec.body) {
      const height = bullets.length > 0 ? 1.2 : CONTENT_H;
      const size = this.fit(
        index,
        [{ text: spec.body }],
        { w: CONTENT_W, h: height },
        bullets.length > 0 ? [24, 22, 20, 18] : [32, 28, 26, 24, 22, 20, 18],
      );
      this.addText(
        slide,
        spec.body,
        { x: SIDE, y: top, w: CONTENT_W, h: height },
        {
          fontSize: size,
          color: bullets.length > 0 ? this.palette.muted : this.palette.text,
        },
      );
      top += height + 0.2;
    }
    if (bullets.length > 0) {
      this.bullets(slide, index, bullets, {
        x: SIDE,
        y: top,
        w: CONTENT_W,
        h: CONTENT_Y + CONTENT_H - top,
      });
    }
  }

  card(slide: PptxGenJS.Slide, box: Box, fill: string) {
    slide.addShape('roundRect', {
      ...box,
      fill: { color: fill },
      line: { color: this.palette.border, width: 0.75 },
      rectRadius: 0.12,
    });
  }

  /** Two or three columns of points, as cards as tall as their longest column needs. */
  columnsSlide(spec: SlideSpec, index: number, comparison: boolean) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const columns = (spec.columns ?? []).slice(0, 3);
    const gap = 0.4;
    const width = (CONTENT_W - gap * (columns.length - 1)) / Math.max(columns.length, 1);
    const colors = [palette.primary, palette.accent, mix(palette.primary, palette.accent, 0.5)];
    const headerH = 0.9;
    const pad = 0.35;
    const innerW = width - pad * 2;
    const bodyH = CONTENT_H - headerH - pad * 2;
    const texts = columns.map((column) => bulletFitText(column.bullets.map((text) => ({ text }))));
    const bodySize = Math.min(
      ...texts.map((text) => this.fit(index, text, { w: innerW, h: bodyH }, CARD_SIZES, bulletGap)),
    );
    const needed = Math.max(
      ...texts.map((text) => textHeight(text, innerW, bodySize, bulletGap(bodySize))),
    );
    const cardH = Math.min(CONTENT_H, Math.max(2.8, headerH + needed + pad * 2 + 0.2));
    columns.forEach((column, i) => {
      const box = {
        x: this.x(SIDE + i * (width + gap), width),
        y: CONTENT_Y + 0.05,
        w: width,
        h: cardH,
      };
      const tone = colors[i];
      this.card(slide, box, palette.surface);
      if (comparison) {
        slide.addShape('roundRect', {
          x: box.x,
          y: box.y,
          w: box.w,
          h: headerH,
          fill: { color: tone },
          line: { color: tone, width: 0 },
          rectRadius: 0.12,
        });
        slide.addShape('rect', {
          x: box.x,
          y: box.y + headerH - 0.2,
          w: box.w,
          h: 0.2,
          fill: { color: tone },
          line: { color: tone, width: 0 },
        });
      } else {
        slide.addShape('rect', {
          x: this.rtl ? box.x + box.w - pad - 0.7 : box.x + pad,
          y: box.y + headerH - 0.12,
          w: 0.7,
          h: 0.06,
          fill: { color: tone },
          line: { color: tone, width: 0 },
        });
      }
      this.addText(
        slide,
        column.heading,
        { x: box.x + pad, y: box.y + 0.12, w: innerW, h: headerH - 0.24 },
        {
          fontSize: this.fit(
            index,
            [{ text: column.heading }],
            { w: innerW, h: headerH - 0.24 },
            [24, 22, 20, 18],
          ),
          bold: true,
          valign: 'middle',
          color: comparison ? textOn(tone) : tone,
        },
      );
      slide.addText(
        this.paragraphs(
          this.bulletLines(
            column.bullets.map((text) => ({ text })),
            bodySize,
          ),
        ),
        {
          ...this.base(),
          x: box.x + pad,
          y: box.y + headerH + pad,
          w: innerW,
          h: cardH - headerH - pad * 2,
        },
      );
    });
  }

  timelineSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const items = (spec.items ?? []).slice(0, 6);
    const step = CONTENT_W / Math.max(items.length, 1);
    const textW = step - 0.3;
    const textSize = Math.min(
      ...items.map((item) =>
        this.fit(index, [{ text: item.text ?? '' }], { w: textW, h: 2.2 }, [20, 18, 16, 14]),
      ),
    );
    const labelSize = Math.min(
      ...items.map((item) =>
        this.fit(index, [{ text: item.label }], { w: step - 0.2, h: 0.8 }, [24, 22, 20, 18, 16]),
      ),
    );
    const lineY = CONTENT_Y + 1.75;
    slide.addShape('rect', {
      x: SIDE,
      y: lineY,
      w: CONTENT_W,
      h: 0.06,
      fill: { color: palette.border },
      line: { color: palette.border, width: 0 },
    });
    items.forEach((item, i) => {
      const center = SIDE + step * i + step / 2;
      const cx = this.rtl ? W - center : center;
      const tone = i % 2 === 0 ? palette.primary : palette.accent;
      slide.addShape('ellipse', {
        x: cx - 0.24,
        y: lineY - 0.21,
        w: 0.48,
        h: 0.48,
        fill: { color: tone },
        line: { color: palette.background, width: 4 },
      });
      this.addText(
        slide,
        item.label,
        { x: cx - step / 2 + 0.1, y: lineY - 1.15, w: step - 0.2, h: 0.85 },
        {
          fontSize: labelSize,
          bold: true,
          align: 'center',
          valign: 'bottom',
          color: tone,
        },
      );
      if (item.text) {
        this.addText(
          slide,
          item.text,
          { x: cx - textW / 2, y: lineY + 0.55, w: textW, h: 2.3 },
          {
            fontSize: textSize,
            align: 'center',
          },
        );
      }
    });
  }

  statsSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const items = (spec.items ?? []).slice(0, 4);
    const gap = 0.35;
    const width = (CONTENT_W - gap * (items.length - 1)) / Math.max(items.length, 1);
    const height = 3.2;
    const top = CONTENT_Y + (CONTENT_H - height - (spec.body ? 0.9 : 0)) / 2;
    const valueSize = Math.min(
      ...items.map((item) =>
        this.fit(
          index,
          [{ text: item.label }],
          { w: width - 0.4, h: 1.2 },
          [60, 54, 48, 40, 34, 28],
        ),
      ),
    );
    const textSize = Math.min(
      ...items.map((item) =>
        this.fit(index, [{ text: item.text ?? '' }], { w: width - 0.5, h: 1.3 }, [20, 18, 16, 14]),
      ),
    );
    items.forEach((item, i) => {
      const box = { x: this.x(SIDE + i * (width + gap), width), y: top, w: width, h: height };
      const tone = i % 2 === 0 ? palette.primary : palette.accent;
      this.card(slide, box, palette.surface);
      slide.addShape('rect', {
        x: box.x + (box.w - 0.8) / 2,
        y: box.y + 0.3,
        w: 0.8,
        h: 0.07,
        fill: { color: tone },
        line: { width: 0, color: tone },
      });
      this.addText(
        slide,
        item.label,
        { x: box.x + 0.2, y: box.y + 0.45, w: box.w - 0.4, h: 1.3 },
        {
          fontSize: valueSize,
          bold: true,
          align: 'center',
          valign: 'middle',
          color: tone,
        },
      );
      if (item.text) {
        this.addText(
          slide,
          item.text,
          { x: box.x + 0.25, y: box.y + 1.8, w: box.w - 0.5, h: 1.25 },
          {
            fontSize: textSize,
            align: 'center',
            color: palette.text,
          },
        );
      }
    });
    if (spec.body) {
      this.addText(
        slide,
        spec.body,
        { x: SIDE, y: top + height + 0.3, w: CONTENT_W, h: 0.6 },
        {
          fontSize: 18,
          color: palette.muted,
          align: 'center',
        },
      );
    }
  }

  tableSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const table = spec.table;
    if (!table) {
      return;
    }
    const columns = Math.max(table.headers.length, ...table.rows.map((row) => row.length));
    const rows = table.rows.slice(0, 12);
    const count = rows.length + (table.headers.length > 0 ? 1 : 0);
    let fontSize = 12;
    if (count <= 5 && columns <= 4) {
      fontSize = 20;
    } else if (count <= 8) {
      fontSize = 16;
    } else if (count <= 10) {
      fontSize = 14;
    }
    /* A cell holds about three lines comfortably; longer text gets a smaller size, and text
       longer still is reported. */
    const longest = Math.max(1, ...[table.headers, ...rows].flat().map((value) => value.length));
    const perLine = ((CONTENT_W / columns) * 72) / (fontSize * GLYPH_EM);
    if (longest > perLine * 3) {
      fontSize = Math.max(12, fontSize - 4);
    }
    if (longest > perLine * 5) {
      this.markCrowded(index);
    }
    const ordered = (cells: string[]) => {
      const padded = Array.from({ length: columns }, (_, i) => cells[i] ?? '');
      return this.rtl ? padded.reverse() : padded;
    };
    /* Cell text goes through the same paragraph writer as text boxes, which reads `rtlMode`;
       the published types leave it off table cells. */
    const direction = { rtlMode: this.rtl } as PptxGenJS.TableCellProps;
    const fillOf = (header: boolean, striped: boolean) => {
      if (header) {
        return palette.primary;
      }
      return striped ? palette.surface : palette.background;
    };
    const cell = (value: string, header: boolean, striped: boolean): PptxGenJS.TableCell => ({
      text: this.text(value),
      options: {
        ...direction,
        fontFace: FONT,
        fontSize,
        bold: header,
        color: header ? palette.onPrimary : palette.text,
        fill: { color: fillOf(header, striped) },
        align: this.align,
        valign: 'middle',
        lang: this.rtl ? 'fa-IR' : 'en-US',
        margin: [6, 10, 6, 10],
      },
    });
    const body: PptxGenJS.TableRow[] = [];
    if (table.headers.length > 0) {
      body.push(ordered(table.headers).map((value) => cell(value, true, false)));
    }
    rows.forEach((row, i) =>
      body.push(ordered(row).map((value) => cell(value, false, i % 2 === 1))),
    );
    const rowH = Math.min(fontSize >= 20 ? 0.8 : 0.62, CONTENT_H / Math.max(body.length, 1));
    slide.addTable(body, {
      x: SIDE,
      y: CONTENT_Y + 0.1,
      w: CONTENT_W,
      rowH,
      border: { type: 'solid', pt: 0.75, color: palette.border },
      autoPage: false,
    });
  }

  chartSlide(spec: SlideSpec, index: number) {
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const chart = spec.chart;
    if (!chart) {
      return;
    }
    const withText = (spec.bullets?.length ?? 0) > 0;
    const chartW = withText ? CONTENT_W * 0.6 : CONTENT_W;
    const box = {
      x: this.x(SIDE + (withText ? CONTENT_W - chartW : 0), chartW),
      y: CONTENT_Y,
      w: chartW,
      h: CONTENT_H,
    };
    this.addChart(slide, chart, box);
    if (withText) {
      const textW = CONTENT_W - chartW - 0.4;
      this.bullets(
        slide,
        index,
        spec.bullets ?? [],
        { x: this.x(SIDE, textW), y: CONTENT_Y + 0.3, w: textW, h: CONTENT_H - 0.6 },
        [24, 22, 20, 18, 16],
      );
    }
  }

  addChart(slide: PptxGenJS.Slide, chart: ChartSpec, box: Box) {
    const { palette } = this;
    this.charts++;
    const data = chart.series.map((series) => ({
      name: series.name,
      labels: chart.categories.map((category) => this.text(category)),
      values: series.values.map((value) => value ?? 0),
    }));
    const font = {
      catAxisLabelFontFace: FONT,
      valAxisLabelFontFace: FONT,
      dataLabelFontFace: FONT,
      legendFontFace: FONT,
      titleFontFace: FONT,
      catAxisLabelColor: palette.muted,
      valAxisLabelColor: palette.muted,
      dataLabelColor: palette.text,
      legendColor: palette.text,
      catAxisLabelFontSize: 14,
      valAxisLabelFontSize: 12,
      dataLabelFontSize: 13,
      legendFontSize: 14,
    };
    const kind = chart.type;
    const pie = kind === 'pie' || kind === 'doughnut';
    const many = chart.series.length > 1;
    /* A single series takes one color: PowerPoint would otherwise color each bar on its own. */
    let colors = palette.chart;
    if (pie) {
      colors = chart.categories.map((_, i) => palette.chart[i % palette.chart.length]);
    } else if (!many) {
      colors = [palette.primary];
    }
    const common: PptxGenJS.IChartOpts = {
      ...box,
      ...font,
      chartColors: colors,
      showLegend: pie || many,
      legendPos: 'b',
      ...(chart.title
        ? {
            showTitle: true,
            title: this.text(chart.title),
            titleFontSize: 16,
            titleColor: palette.text,
          }
        : {}),
    };
    if (kind === 'pie' || kind === 'doughnut') {
      slide.addChart(kind, data, {
        ...common,
        showPercent: true,
        showValue: false,
        ...(kind === 'doughnut' ? { holeSize: 58 } : {}),
      });
      return;
    }
    const types: Record<typeof kind, PptxGenJS.CHART_NAME> = {
      column: 'bar',
      bar: 'bar',
      line: 'line',
      area: 'area',
    };
    const fewPoints = chart.categories.length <= 12 && chart.series.length <= 3;
    slide.addChart(types[kind], data, {
      ...common,
      ...(chart.type === 'column' || chart.type === 'bar'
        ? { barDir: chart.type === 'bar' ? 'bar' : 'col', barGapWidthPct: 60 }
        : {}),
      ...(chart.stacked ? { barGrouping: 'stacked' } : {}),
      ...(chart.type === 'line' ? { lineSize: 3, lineDataSymbolSize: 8 } : {}),
      showValue: fewPoints && chart.type !== 'area',
      valGridLine: { color: palette.border, size: 0.75 },
      catGridLine: { style: 'none' },
      valAxisLineShow: false,
    });
  }

  quoteSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec, palette.surface);
    const quote = spec.quote ?? { text: spec.body ?? spec.title ?? '' };
    /* U+201C has no mirrored form, so it reads as an opening quote in either direction. */
    this.addText(
      slide,
      '\u201C',
      { x: this.x(SIDE, 1.6), y: 0.6, w: 1.6, h: 1.8 },
      {
        fontSize: 120,
        bold: true,
        color: palette.primary,
      },
    );
    const size = this.fit(
      index,
      [{ text: quote.text }],
      { w: CONTENT_W - 1.2, h: 3.4 },
      [36, 32, 28, 24, 22, 20],
    );
    this.addText(
      slide,
      quote.text,
      { x: this.x(SIDE + 0.6, CONTENT_W - 1.2), y: 2.0, w: CONTENT_W - 1.2, h: 3.4 },
      {
        fontSize: size,
        bold: true,
        valign: 'middle',
      },
    );
    if (quote.author) {
      this.addText(
        slide,
        `— ${quote.author}`,
        { x: this.x(SIDE + 0.6, CONTENT_W - 1.2), y: 5.6, w: CONTENT_W - 1.2, h: 0.6 },
        {
          fontSize: 20,
          color: palette.muted,
        },
      );
    }
    this.logo(slide, { x: this.x(W - SIDE - 1.5, 1.5), y: 0.55, w: 1.5, h: 0.6 });
  }

  async imageSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec);
    this.chrome(slide, spec, index);
    const imageW = CONTENT_W * 0.47;
    const textW = CONTENT_W - imageW - 0.45;
    const image = spec.image!;
    const frame = {
      x: this.x(SIDE + textW + 0.45, imageW),
      y: CONTENT_Y,
      w: imageW,
      h: CONTENT_H - (spec.caption ? 0.45 : 0),
    };
    const cropped = await cropToAspect(image, frame.w / frame.h);
    this.images++;
    slide.addImage({ data: dataUrl(cropped), ...frame, altText: spec.caption ?? spec.title ?? '' });
    if (spec.caption) {
      this.addText(
        slide,
        spec.caption,
        { x: frame.x, y: frame.y + frame.h + 0.08, w: frame.w, h: 0.35 },
        {
          fontSize: 12,
          color: palette.muted,
          align: 'center',
        },
      );
    }
    let top = CONTENT_Y;
    if (spec.body) {
      const size = this.fit(
        index,
        [{ text: spec.body }],
        { w: textW, h: spec.bullets?.length ? 1.6 : CONTENT_H },
        [24, 22, 20, 18, 16],
      );
      const h = spec.bullets?.length ? 1.6 : CONTENT_H;
      this.addText(
        slide,
        spec.body,
        { x: this.x(SIDE, textW), y: top, w: textW, h },
        { fontSize: size },
      );
      top += h + 0.15;
    }
    if (spec.bullets?.length) {
      this.bullets(
        slide,
        index,
        spec.bullets,
        { x: this.x(SIDE, textW), y: top, w: textW, h: CONTENT_Y + CONTENT_H - top },
        [22, 20, 18, 16],
      );
    }
  }

  async imageFullSlide(spec: SlideSpec, index: number) {
    const { palette } = this;
    const slide = this.newSlide(spec, palette.text);
    const cropped = await cropToAspect(spec.image!, W / H);
    this.images++;
    slide.addImage({
      data: dataUrl(cropped),
      x: 0,
      y: 0,
      w: W,
      h: H,
      altText: spec.caption ?? spec.title ?? '',
    });
    slide.addShape('rect', {
      x: 0,
      y: H - 2.3,
      w: W,
      h: 2.3,
      fill: { color: '000000', transparency: 45 },
      line: { color: '000000', transparency: 100, width: 0 },
    });
    if (spec.title) {
      const size = this.fit(
        index,
        [{ text: spec.title }],
        { w: CONTENT_W, h: 1.1 },
        [36, 32, 28, 24],
      );
      this.addText(
        slide,
        spec.title,
        { x: SIDE, y: H - 2.1, w: CONTENT_W, h: 1.1 },
        {
          fontSize: size,
          bold: true,
          color: 'FFFFFF',
          valign: 'bottom',
        },
      );
    }
    const caption = spec.caption ?? spec.body;
    if (caption) {
      this.addText(
        slide,
        caption,
        { x: SIDE, y: H - 0.95, w: CONTENT_W, h: 0.6 },
        {
          fontSize: 16,
          color: 'E5E7EB',
        },
      );
    }
  }

  async slide(spec: SlideSpec, index: number) {
    switch (spec.layout) {
      case 'title':
        return this.titleSlide(spec);
      case 'closing':
        return this.titleSlide(spec, true);
      case 'section':
        return this.sectionSlide(spec, index);
      case 'agenda':
        return this.agendaSlide(spec, index);
      case 'two_column':
        return this.columnsSlide(spec, index, false);
      case 'comparison':
        return this.columnsSlide(spec, index, true);
      case 'timeline':
        return this.timelineSlide(spec, index);
      case 'stats':
        return this.statsSlide(spec, index);
      case 'table':
        return this.tableSlide(spec, index);
      case 'chart':
        return this.chartSlide(spec, index);
      case 'quote':
        return this.quoteSlide(spec, index);
      case 'image':
        return spec.image ? this.imageSlide(spec, index) : this.bulletsSlide(spec, index);
      case 'image_full':
        return spec.image ? this.imageFullSlide(spec, index) : this.bulletsSlide(spec, index);
      default:
        return this.bulletsSlide(spec, index);
    }
  }
}

function dataUrl(image: PreparedImage): string {
  return `data:image/${image.type === 'png' ? 'png' : 'jpeg'};base64,${image.data.toString('base64')}`;
}

/**
 * A PowerPoint deck from checked slides: widescreen, right to left for Persian (the first
 * column, timeline step and table column on the right), every text in Vazirmatn, native charts
 * in the deck's colors, and the logo on every slide. Text sizes are chosen from each text's
 * length; slides whose text is too long even at the smallest size are reported as crowded.
 */
export async function buildPresentation(deck: DeckSpec): Promise<DeckResult> {
  const writer = new DeckWriter(deck);
  for (const [index, spec] of deck.slides.entries()) {
    await writer.slide(spec, index);
  }
  const output = await writer.pptx.write({ outputType: 'nodebuffer' });
  return {
    buffer: Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer),
    slides: deck.slides.length,
    charts: writer.charts,
    images: writer.images,
    crowded: writer.crowded,
  };
}
