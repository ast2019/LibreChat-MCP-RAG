import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import { OfficeTools, OFFICE_ARTIFACT_KEY, OFFICE_FILE_CONTEXT } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { TOfficeToolsConfig } from 'librechat-data-provider';
import type { SlideBullet, SlideColumn, SlideItem, SlideSpec } from './slides';
import type { DeckStyle, DocumentStyle } from './theme';
import type { WordReference, WordSeo } from './word';
import type { PreparedImage } from './images';
import type { SlideLayout } from './layouts';
import type { ServerRequest } from '~/types';
import type { Direction } from './text';
import { SOLAR_MONTHS, jdnToSolar, toPersianDigits, todayJdn } from '~/persian/calendar';
import { dominantDirection, officeFilename, parseHexColor } from './text';
import { DECK_STYLES, deckPalette, documentAccent } from './theme';
import { normalizePersianText } from '~/persian/normalize';
import { officeToolDefinitions } from './definitions';
import { brandColor, prepareImage } from './images';
import { getPersianConfig } from '~/persian/config';
import { buildPresentation } from './slides';
import { buildWordDocument } from './word';
import { parseMarkdown } from './markdown';
import { getOfficeConfig } from './config';
import { SLIDE_LAYOUTS } from './layouts';
import { readChart } from './charts';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const VAZIRMATN_URL = 'https://github.com/rastikerdar/vazirmatn/releases';
/** The product name written into each file's properties. */
const CREATOR = 'HiveGPT';
/** How long a call waits for an image that generate_image is still saving. */
const IMAGE_WAIT_MS = 8_000;
const IMAGE_RETRY_MS = 1_000;
const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;
/** How many items each layout draws: an agenda in two columns, up to four key numbers, six steps. */
const ITEM_LIMITS = { agenda: 12, stats: 4, timeline: 6 } as const;

/** A saved Office file as the chat attaches it to the message. */
export interface OfficeFile {
  file_id: string;
  filename: string;
  filepath: string;
  type: string;
  bytes: number;
  source?: string;
  user?: string;
  context?: string;
  conversationId?: string;
}

export interface OfficeToolDeps {
  /** Saves the file for the request's user, where the user downloads it. */
  saveDocument: (
    req: ServerRequest,
    file: {
      buffer: Buffer;
      type: string;
      filename: string;
      context: string;
      conversationId?: string;
    },
  ) => Promise<OfficeFile>;
  /** One of the user's own images as bytes; null when it is not theirs, or not yet saved. */
  loadImage: (
    req: ServerRequest,
    fileId: string,
  ) => Promise<{ buffer: Buffer; type: string } | null>;
  /** Vazirmatn's regular and bold faces, embedded in Word files; null when unavailable. */
  loadFonts?: () => Promise<{ regular: Buffer; bold: Buffer } | null>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

type TextPart = { type: 'text'; text: string };
type ToolResult = [TextPart[], { [OFFICE_ARTIFACT_KEY]?: OfficeFile[] }];

interface RunnableConfig {
  configurable?: { thread_id?: string };
}

const reply = (message: string): ToolResult => [[{ type: 'text', text: message }], {}];

function str(value: unknown, max = 2_000): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  return text === '' ? undefined : text.slice(0, max);
}

function strings(value: unknown, maxItems: number, maxLength = 400): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => str(item, maxLength))
    .filter((item): item is string => item != null)
    .slice(0, maxItems);
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function versionOf(value: unknown): number {
  const version = Math.round(Number(value));
  return Number.isFinite(version) && version >= 1 ? Math.min(version, 999) : 1;
}

function directionOf(value: unknown, texts: string[]): Direction {
  return value === 'ltr' || value === 'rtl' ? value : dominantDirection(texts);
}

/**
 * Bullets as the model writes them: a bullet starting with "- " belongs under the one before,
 * unless every bullet starts that way, which is just Markdown habit.
 */
export function readBullets(value: unknown, maxItems = 12): SlideBullet[] {
  const entries = strings(value, maxItems * 3, 500);
  const marker = /^\s*[-–•]\s+/;
  const nested = entries.some((entry) => !marker.test(entry));
  const bullets: SlideBullet[] = [];
  for (const entry of entries) {
    const text = entry.replace(marker, '');
    if (nested && marker.test(entry) && bullets.length > 0) {
      const parent = bullets[bullets.length - 1];
      parent.sub = [...(parent.sub ?? []), text].slice(0, 4);
      continue;
    }
    if (bullets.length < maxItems) {
      bullets.push({ text });
    }
  }
  return bullets;
}

/** «۹ آبان ۱۴۰۵» in Tehran time for a Persian document, «October 31, 2026» otherwise. */
function dateLine(direction: Direction, now: Date, timeZone: string): string {
  if (direction === 'rtl') {
    const solar = jdnToSolar(todayJdn(now, timeZone));
    return `${toPersianDigits(solar.day)} ${SOLAR_MONTHS[solar.month - 1]} ${toPersianDigits(solar.year)}`;
  }
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone }).format(now);
}

/**
 * The Word and PowerPoint builders. Each call checks the input, loads the user's own images
 * (waiting briefly for one generate_image is still saving), builds the file locally, saves it to
 * the user's files and attaches it to the message. Nothing leaves the server and nothing is
 * charged; a call that cannot build a file says why so the model can fix it.
 */
export function createOfficeTools(
  { req, toolNames }: { req: ServerRequest; toolNames: readonly string[] },
  deps: OfficeToolDeps,
): StructuredToolInterface[] {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** Loads each image once per call; the waits for images still being saved share one budget. */
  function imageLoader() {
    let waited = 0;
    const cache = new Map<string, Promise<PreparedImage | null>>();
    const load = async (id: string): Promise<PreparedImage | null> => {
      for (;;) {
        const found = await deps.loadImage(req, id);
        if (found) {
          try {
            return await prepareImage(found.buffer);
          } catch (error) {
            logger.warn('[office] An image could not be read', { error: (error as Error).message });
            return null;
          }
        }
        if (waited + IMAGE_RETRY_MS > IMAGE_WAIT_MS) {
          return null;
        }
        waited += IMAGE_RETRY_MS;
        await sleep(IMAGE_RETRY_MS);
      }
    };
    return (id: string | undefined): Promise<PreparedImage | null> => {
      if (!id || !FILE_ID.test(id)) {
        return Promise.resolve(null);
      }
      let pending = cache.get(id);
      if (!pending) {
        pending = load(id);
        cache.set(id, pending);
      }
      return pending;
    };
  }

  async function save(
    buffer: Buffer,
    type: string,
    filename: string,
    run: RunnableConfig | undefined,
  ): Promise<OfficeFile> {
    return deps.saveDocument(req, {
      buffer,
      type,
      filename,
      context: OFFICE_FILE_CONTEXT,
      conversationId: run?.configurable?.thread_id,
    });
  }

  async function wordDocument(
    config: TOfficeToolsConfig,
    input: Record<string, unknown>,
    run: RunnableConfig | undefined,
  ): Promise<ToolResult> {
    const rawTitle = str(input.title, 300);
    const rawMarkdown = typeof input.markdown === 'string' ? input.markdown.trim() : '';
    if (!rawTitle || rawMarkdown === '') {
      return reply('Nothing was built: the document needs a `title` and its body in `markdown`.');
    }
    if (rawMarkdown.length > config.maxDocumentChars) {
      return reply(
        `Nothing was built: the body is ${rawMarkdown.length} characters, more than the ${config.maxDocumentChars} one file takes. Split it into parts, or shorten it.`,
      );
    }
    const direction = directionOf(input.direction, [rawTitle, rawMarkdown]);
    const tidy = (text: string | undefined) =>
      text != null && direction === 'rtl' ? normalizePersianText(text).text : text;
    const title = tidy(rawTitle)!;
    const markdown = tidy(rawMarkdown)!;
    const style = (['formal', 'modern', 'academic'] as const).includes(input.style as DocumentStyle)
      ? (input.style as DocumentStyle)
      : 'formal';
    const references: WordReference[] = (Array.isArray(input.references) ? input.references : [])
      .slice(0, 100)
      .map((entry) => record(entry))
      .map((entry) => ({
        title: tidy(str(entry.title, 500)) ?? '',
        author: tidy(str(entry.author, 300)),
        publisher: tidy(str(entry.publisher, 300)),
        date: str(entry.date, 100),
        url: str(entry.url, 2_000),
      }))
      .filter((entry) => entry.title !== '');
    const seoInput = record(input.seo);
    const seo: WordSeo = {
      title: tidy(str(seoInput.title, 200)),
      description: tidy(str(seoInput.description, 400)),
      slug: str(seoInput.slug, 200),
      keywords: strings(seoInput.keywords, 20, 100).map((keyword) => tidy(keyword)!),
    };

    const loadImage = imageLoader();
    const refs = new Set<string>();
    const collect = (blocks: ReturnType<typeof parseMarkdown>) => {
      for (const block of blocks) {
        if (block.kind === 'image' && block.ref) {
          refs.add(block.ref);
        } else if (block.kind === 'quote') {
          collect(block.blocks);
        } else if (block.kind === 'list') {
          block.items.forEach((item) => collect(item.blocks));
        }
      }
    };
    collect(parseMarkdown(markdown, title));
    const wanted = [...refs].slice(0, config.maxImages);
    const [loaded, logo, fonts] = await Promise.all([
      Promise.all(wanted.map(async (ref) => [ref, await loadImage(ref)] as const)),
      loadImage(str(input.logo_image_id, 100)),
      config.embedFonts ? (deps.loadFonts?.() ?? Promise.resolve(null)) : Promise.resolve(null),
    ]);
    const images = new Map<string, PreparedImage>();
    for (const [ref, image] of loaded) {
      if (image) {
        images.set(ref, image);
      }
    }
    const version = versionOf(input.version);
    const result = await buildWordDocument(
      {
        title,
        subtitle: tidy(str(input.subtitle, 400)),
        author: tidy(str(input.author, 200)),
        date: dateLine(direction, now(), getPersianConfig(req.config).timezone),
        summary: tidy(str(input.summary, 4_000)),
        keywords: strings(input.keywords, 20, 100).map((keyword) => tidy(keyword)!),
        markdown,
        references,
        seo,
        toc: typeof input.toc === 'boolean' ? input.toc : undefined,
        cover: input.cover !== false,
        direction,
        accent: documentAccent(style, parseHexColor(input.accent_color)),
        creator: CREATOR,
      },
      { images, logo: logo ?? undefined, fonts },
    );
    const warnings = [...result.warnings];
    if (refs.size > wanted.length) {
      warnings.push(`Only the first ${config.maxImages} images were added.`);
    }
    if (input.logo_image_id && !logo) {
      warnings.push("The logo is not one of the user's images, so the cover has none.");
    }
    const filename = officeFilename(title, 'docx', { version, direction });
    const file = await save(result.buffer, DOCX_MIME, filename, run);
    const parts = [
      `The Word file «${filename}» is ready: about ${result.words} words in ${Math.max(result.sections, 1)} sections`,
      result.tables ? `, ${result.tables} tables` : '',
      result.images ? `, ${result.images} images` : '',
      result.charts ? `, ${result.charts} charts` : '',
      '. The chat already shows it as a file card the user can download and edit; do not write a link to it.',
      fonts
        ? ' The Vazirmatn font is embedded in the file, so Word shows it as designed without installing anything.'
        : ` Tell the user it uses the free Vazirmatn font (${VAZIRMATN_URL}); without it, Word shows a similar font.`,
      ` To change it, call ${OfficeTools.word} again with the whole updated document and version ${version + 1}; this version stays in the chat.`,
      warnings.length ? ` Tell the user: ${warnings.join(' ')}` : '',
    ];
    return [[{ type: 'text', text: parts.join('') }], { [OFFICE_ARTIFACT_KEY]: [file] }];
  }

  async function presentation(
    config: TOfficeToolsConfig,
    input: Record<string, unknown>,
    run: RunnableConfig | undefined,
  ): Promise<ToolResult> {
    const rawTitle = str(input.title, 300);
    const rawSlides = Array.isArray(input.slides) ? input.slides.map((slide) => record(slide)) : [];
    if (!rawTitle || rawSlides.length === 0) {
      return reply(
        'Nothing was built: the deck needs a `title` and at least one slide in `slides`.',
      );
    }
    if (rawSlides.length > config.maxSlides) {
      return reply(
        `Nothing was built: one deck takes at most ${config.maxSlides} slides and this one has ${rawSlides.length}. Merge slides, or split the deck into two files.`,
      );
    }
    const sample = [
      rawTitle,
      ...rawSlides.flatMap((slide) => [str(slide.title) ?? '', ...strings(slide.bullets, 12)]),
    ];
    const direction = directionOf(input.direction, sample);
    const tidy = (text: string | undefined) =>
      text != null && direction === 'rtl' ? normalizePersianText(text).text : text;
    const tidyAll = (texts: string[]) => texts.map((text) => tidy(text)!);
    const loadImage = imageLoader();
    const warnings: string[] = [];
    let imageBudget = config.maxImages;

    const slides: SlideSpec[] = [];
    for (const [index, raw] of rawSlides.entries()) {
      const number = index + 1;
      const requested = String(raw.layout ?? 'bullets') as SlideLayout;
      let layout: SlideLayout = SLIDE_LAYOUTS.includes(requested) ? requested : 'bullets';
      if (layout !== requested) {
        warnings.push(`Slide ${number} asked for an unknown layout and was drawn as bullets.`);
      }
      const bullets = readBullets(raw.bullets).map((bullet) => ({
        text: tidy(bullet.text)!,
        ...(bullet.sub ? { sub: tidyAll(bullet.sub) } : {}),
      }));
      const spec: SlideSpec = {
        layout,
        title: tidy(str(raw.title, 300)),
        subtitle: tidy(str(raw.subtitle, 400)),
        body: tidy(str(raw.body, 1_500)),
        ...(bullets.length ? { bullets } : {}),
        caption: tidy(str(raw.caption, 300)),
        notes: tidy(str(raw.notes, 5_000)),
      };
      const fallback = (reason: string) => {
        warnings.push(`Slide ${number}: ${reason}, so it was drawn as a bullet slide.`);
        layout = 'bullets';
        spec.layout = 'bullets';
      };
      if (layout === 'two_column' || layout === 'comparison') {
        const columns: SlideColumn[] = (Array.isArray(raw.columns) ? raw.columns : [])
          .slice(0, 3)
          .map((column) => record(column))
          .map((column) => ({
            heading: tidy(str(column.heading, 200)) ?? '',
            bullets: tidyAll(strings(column.bullets, 8, 300)),
          }));
        if (columns.length >= 2) {
          spec.columns = columns;
        } else {
          fallback('it needs two columns');
        }
      }
      if (layout === 'timeline' || layout === 'stats' || layout === 'agenda') {
        const items: SlideItem[] = (Array.isArray(raw.items) ? raw.items : [])
          .slice(0, ITEM_LIMITS[layout])
          .map((item) => record(item))
          .map((item) => ({
            label: tidy(str(item.label, 120)) ?? '',
            text: tidy(str(item.text, 400)),
          }))
          .filter((item) => item.label !== '');
        if (items.length > 0) {
          spec.items = items;
        } else if (!(layout === 'agenda' && bullets.length > 0)) {
          fallback(`it needs \`items\` for the ${layout}`);
        }
      }
      if (layout === 'table') {
        const table = record(raw.table);
        const rows = (Array.isArray(table.rows) ? table.rows : [])
          .slice(0, 12)
          .map((row) => tidyAll(strings(row, 8, 200)));
        if (rows.length > 0) {
          spec.table = { headers: tidyAll(strings(table.headers, 8, 200)), rows };
        } else {
          fallback('its table has no rows');
        }
      }
      if (layout === 'chart') {
        const chart = readChart(raw.chart);
        if (chart.ok) {
          spec.chart = {
            ...chart.chart,
            ...(chart.chart.title ? { title: tidy(chart.chart.title) } : {}),
            categories: tidyAll(chart.chart.categories),
            series: chart.chart.series.map((series) => ({ ...series, name: tidy(series.name)! })),
          };
        } else {
          fallback(`the chart was left out (${chart.error})`);
        }
      }
      if (layout === 'quote') {
        const quote = record(raw.quote);
        const text = tidy(str(quote.text, 600)) ?? spec.body;
        if (text) {
          spec.quote = { text, author: tidy(str(quote.author, 200)) };
        } else {
          fallback('the quote has no text');
        }
      }
      if (layout === 'image' || layout === 'image_full') {
        const id = str(raw.image_id, 100);
        const image = imageBudget > 0 ? await loadImage(id) : null;
        if (image) {
          imageBudget--;
          spec.image = image;
        } else {
          fallback(
            imageBudget > 0
              ? `the image ${id ?? '(no image_id)'} is not one of the user's images`
              : `one deck takes at most ${config.maxImages} images`,
          );
        }
      }
      slides.push(spec);
    }

    const logo = await loadImage(str(input.logo_image_id, 100));
    if (input.logo_image_id && !logo) {
      warnings.push("The logo is not one of the user's images, so the slides have none.");
    }
    const style = DECK_STYLES.includes(input.style as DeckStyle)
      ? (input.style as DeckStyle)
      : 'minimal';
    const brand = parseHexColor(input.primary_color) ?? (logo ? await brandColor(logo) : null);
    const palette = deckPalette(style, {
      primary: brand,
      accent: parseHexColor(input.accent_color),
    });
    const title = tidy(rawTitle)!;
    const version = versionOf(input.version);
    const result = await buildPresentation({
      title,
      subtitle: tidy(str(input.subtitle, 400)),
      author: tidy(str(input.author, 200)),
      date: dateLine(direction, now(), getPersianConfig(req.config).timezone),
      direction,
      palette,
      slides,
      logo: logo ?? undefined,
      creator: CREATOR,
    });
    const filename = officeFilename(title, 'pptx', { version, direction });
    const file = await save(result.buffer, PPTX_MIME, filename, run);
    const parts = [
      `The PowerPoint file «${filename}» is ready: ${result.slides} slides`,
      result.charts ? `, ${result.charts} charts` : '',
      result.images ? `, ${result.images} images` : '',
      logo ? ', with the logo on every slide and its brand color' : '',
      '. The chat already shows it as a file card the user can download and edit; do not write a link to it.',
      ` Tell the user it uses the free Vazirmatn font: PowerPoint shows the slides as designed once it is installed (${VAZIRMATN_URL}), and Google Slides has it built in.`,
      result.crowded.length
        ? ` Slides ${result.crowded.join(', ')} have more text than fits comfortably; offer to shorten them or split each into two.`
        : '',
      ` To change the deck, call ${OfficeTools.slides} again with every slide and version ${version + 1}; this version stays in the chat.`,
      warnings.length ? ` Tell the user: ${warnings.join(' ')}` : '',
    ];
    return [[{ type: 'text', text: parts.join('') }], { [OFFICE_ARTIFACT_KEY]: [file] }];
  }

  function guarded(
    name: OfficeTools,
    enabled: (config: TOfficeToolsConfig) => boolean,
    build: (
      config: TOfficeToolsConfig,
      input: Record<string, unknown>,
      run: RunnableConfig | undefined,
    ) => Promise<ToolResult>,
  ) {
    return async (input: unknown, runnable: unknown): Promise<ToolResult> => {
      const config = getOfficeConfig(req.config);
      if (!enabled(config) || !req.user?.id) {
        return reply('This builder is not available on this deployment.');
      }
      try {
        return await build(config, record(input), runnable as RunnableConfig | undefined);
      } catch (error) {
        logger.error(`[office] ${name} failed`, error);
        return reply(
          'The file could not be built because of an error on the server, and nothing was saved. Apologise to the user and suggest trying again.',
        );
      }
    };
  }

  const builders: Record<OfficeTools, () => StructuredToolInterface> = {
    [OfficeTools.word]: () =>
      tool(
        guarded(OfficeTools.word, (config) => config.word, wordDocument),
        {
          ...officeToolDefinitions[OfficeTools.word],
        } as never,
      ) as unknown as StructuredToolInterface,
    [OfficeTools.slides]: () =>
      tool(
        guarded(OfficeTools.slides, (config) => config.slides, presentation),
        {
          ...officeToolDefinitions[OfficeTools.slides],
        } as never,
      ) as unknown as StructuredToolInterface,
  };

  return toolNames
    .filter((name): name is OfficeTools => name in builders)
    .map((name) => builders[name]());
}
