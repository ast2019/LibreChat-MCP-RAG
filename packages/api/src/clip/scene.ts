import type { TClipToolsConfig } from 'librechat-data-provider';
import { resolveClipTheme } from './themes';
import type { ClipTheme } from './themes';

/**
 * Storyboard v2: the model writes typed scenes; this module validates the tool input strictly
 * and normalizes it into the worker contract (`deploy/remotion/src/storyboard.mjs`, which
 * validates again). Errors name the exact field (`scenes[2].data[1].value: must be a number`).
 */
export const CLIP_SCENE_TYPES = [
  'hook',
  'stat',
  'chart',
  'icons',
  'steps',
  'timeline',
  'compare',
  'quote',
  'image',
  'split',
  'list',
  'location',
  'cta',
  'logo',
] as const;
export type ClipSceneType = (typeof CLIP_SCENE_TYPES)[number];

export const CLIP_ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const;
export type ClipAspectRatio = (typeof CLIP_ASPECT_RATIOS)[number];

export const CLIP_TRANSITIONS = ['fade', 'slide', 'wipe', 'flip', 'clock-wipe', 'none'] as const;
export const CLIP_CHARTS = ['bar', 'line', 'pie', 'donut'] as const;
export const CLIP_IMAGE_MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'still'] as const;
export const CLIP_MUSIC_TRACKS = ['ambient', 'pulse', 'cinematic'] as const;
export type ClipMusicTrack = (typeof CLIP_MUSIC_TRACKS)[number];
export type ClipAudioMode = 'none' | 'tts' | 'upload';

/** Where a scene image comes from. */
export type ClipImageSource =
  | { source: 'file'; fileId: string }
  | { source: 'ai'; prompt: string }
  | { source: 'stock'; query: string };

/** An image the job must fetch or generate before the render, by asset id. */
export type ClipImageRef = { id: string } & ClipImageSource;

/** One validated scene in the worker's camelCase shape (typed fields per scene type). */
export type ClipScene = { type: ClipSceneType; durationSec: number } & Record<string, unknown>;

export interface ClipStoryboard {
  title: string;
  lang?: 'fa' | 'en';
  aspectRatio: ClipAspectRatio;
  theme: ClipTheme;
  brandName: string;
  brandColor?: string;
  logo?: string;
  captions: boolean;
  music?: { track: ClipMusicTrack; volume: number };
  scenes: ClipScene[];
}

export interface ClipAudioSpec {
  mode: ClipAudioMode;
  fileId?: string;
  voice?: string;
}

/** The validated tool call: what the job stores (no bytes) and later sends to the worker. */
export interface ClipRequest {
  storyboard: ClipStoryboard;
  images: ClipImageRef[];
  audio: ClipAudioSpec;
  durationSec: number;
  preview: boolean;
  version: number;
  /** Non-fatal notes for the model (a legacy theme id, a capped option) */
  notes: string[];
}

/** The body of `POST /jobs` and `POST /stills` on the worker. */
export interface WorkerJobRequest {
  storyboard: ClipStoryboard;
  assets: Record<string, { kind: 'image' | 'audio'; mime: string; base64: string; credit?: string }>;
  audio: { mode: ClipAudioMode; voice?: string; asset?: string };
  shortSide: number;
  maxDurationSec: number;
  timeoutMs: number;
  stills?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;
const VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;
const PERSIAN = /[\u0600-\u06FF]/;
/** Speech rate used to reject narration that cannot fit before anything is rendered. */
const CHARS_PER_SEC = { fa: 13, en: 15 } as const;

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  value != null && typeof value === 'object' && !Array.isArray(value);

class Problems {
  readonly errors: string[] = [];
  error(path: string, message: string): void {
    if (this.errors.length < 10) {
      this.errors.push(`${path}: ${message}`);
    }
  }
}

interface Ctx {
  p: Problems;
  images: ClipImageRef[];
  config: TClipToolsConfig;
}

function str(
  ctx: Ctx,
  path: string,
  value: unknown,
  max: number,
  required = false,
): string | undefined {
  if (value == null || value === '') {
    if (required) {
      ctx.p.error(path, 'is required');
    }
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    ctx.p.error(path, 'must be a string');
    return undefined;
  }
  const out = String(value).replace(/\s+/g, ' ').trim();
  if (!out) {
    if (required) {
      ctx.p.error(path, 'is required');
    }
    return undefined;
  }
  if (out.length > max) {
    ctx.p.error(path, `must be at most ${max} characters (got ${out.length})`);
    return undefined;
  }
  return out;
}

function num(
  ctx: Ctx,
  path: string,
  value: unknown,
  min: number,
  max: number,
  required = false,
): number | undefined {
  if (value == null || value === '') {
    if (required) {
      ctx.p.error(path, 'is required');
    }
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    ctx.p.error(path, 'must be a number');
    return undefined;
  }
  if (value < min || value > max) {
    ctx.p.error(path, `must be between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function pick<T extends string>(
  ctx: Ctx,
  path: string,
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    ctx.p.error(path, `must be one of ${options.join(', ')}`);
    return fallback;
  }
  return value as T;
}

function arr(
  ctx: Ctx,
  path: string,
  value: unknown,
  min: number,
  max: number,
  required = true,
): unknown[] {
  if (value == null) {
    if (required) {
      ctx.p.error(path, `is required (${min}-${max} items)`);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    ctx.p.error(path, 'must be an array');
    return [];
  }
  if (value.length < min || value.length > max) {
    ctx.p.error(path, `must have ${min}-${max} items (got ${value.length})`);
    return [];
  }
  return value;
}

function strs(
  ctx: Ctx,
  path: string,
  value: unknown,
  min: number,
  max: number,
  maxChars: number,
  required = true,
): string[] {
  return arr(ctx, path, value, min, max, required)
    .map((item, i) => str(ctx, `${path}[${i}]`, item, maxChars, true))
    .filter((item): item is string => item != null);
}

const icon = (ctx: Ctx, path: string, value: unknown): string | undefined =>
  str(ctx, path, value, 48);

/** `{ source: 'file'|'ai'|'stock', ... }` -> an asset id the worker receives bytes for. */
function image(ctx: Ctx, path: string, value: unknown, required: boolean): string | undefined {
  if (value == null || value === '') {
    if (required) {
      ctx.p.error(path, 'is required: { source: "file", file_id } | { source: "ai", prompt } | { source: "stock", query }');
    }
    return undefined;
  }
  if (!isObj(value)) {
    ctx.p.error(path, 'must be an object { source, file_id | prompt | query }');
    return undefined;
  }
  const id = `img${ctx.images.length}`;
  if (value.source === 'file') {
    const fileId = str(ctx, `${path}.file_id`, value.file_id, 100, true);
    if (fileId && !FILE_ID.test(fileId)) {
      ctx.p.error(`${path}.file_id`, 'is not a valid file id');
      return undefined;
    }
    if (fileId) {
      ctx.images.push({ id, source: 'file', fileId });
      return id;
    }
    return undefined;
  }
  if (value.source === 'ai') {
    if (!ctx.config.aiImages) {
      ctx.p.error(path, 'AI images are turned off on this deployment; use an attached image (source "file"), icons, or another scene type');
      return undefined;
    }
    const prompt = str(ctx, `${path}.prompt`, value.prompt, 600, true);
    if (prompt) {
      ctx.images.push({ id, source: 'ai', prompt });
      return id;
    }
    return undefined;
  }
  if (value.source === 'stock') {
    const query = str(ctx, `${path}.query`, value.query, 80, true);
    if (query) {
      ctx.images.push({ id, source: 'stock', query });
      return id;
    }
    return undefined;
  }
  ctx.p.error(`${path}.source`, 'must be one of file, ai, stock');
  return undefined;
}

type Parser = (ctx: Ctx, at: string, s: Obj) => Obj;

const items = (
  ctx: Ctx,
  path: string,
  value: unknown,
  min: number,
  max: number,
  each: (item: Obj, at: string) => Obj,
): Obj[] =>
  arr(ctx, path, value, min, max).map((item, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(item)) {
      ctx.p.error(at, 'must be an object');
      return {};
    }
    return each(item, at);
  });

const PARSERS: Record<ClipSceneType, Parser> = {
  hook: (c, at, s) => ({
    headline: str(c, `${at}.headline`, s.headline, 90, true),
    subline: str(c, `${at}.subline`, s.subline, 160),
    kicker: str(c, `${at}.kicker`, s.kicker, 40),
    emphasis: strs(c, `${at}.emphasis`, s.emphasis, 0, 4, 30, false),
    icon: icon(c, `${at}.icon`, s.icon),
  }),
  stat: (c, at, s) => ({
    value: num(c, `${at}.value`, s.value, -1e15, 1e15, true),
    decimals: num(c, `${at}.decimals`, s.decimals, 0, 2),
    prefix: str(c, `${at}.prefix`, s.prefix, 6),
    suffix: str(c, `${at}.suffix`, s.suffix, 12),
    label: str(c, `${at}.label`, s.label, 90, true),
    caption: str(c, `${at}.caption`, s.caption, 160),
    icon: icon(c, `${at}.icon`, s.icon),
  }),
  chart: (c, at, s) => {
    const chart = pick(c, `${at}.chart`, s.chart, CLIP_CHARTS, 'bar');
    const round = chart === 'pie' || chart === 'donut';
    const data = items(c, `${at}.data`, s.data, 2, 8, (d, p) => ({
      label: str(c, `${p}.label`, d.label, 24, true),
      value: num(c, `${p}.value`, d.value, round ? 0 : -1e15, 1e15, true),
    }));
    const highlight = num(c, `${at}.highlight`, s.highlight, 0, 7);
    if (highlight != null && highlight >= data.length) {
      c.p.error(`${at}.highlight`, 'must be the index of a data point');
    }
    return {
      chart,
      title: str(c, `${at}.title`, s.title, 90),
      unit: str(c, `${at}.unit`, s.unit, 12),
      caption: str(c, `${at}.caption`, s.caption, 160),
      data,
      highlight: highlight != null ? Math.round(highlight) : undefined,
    };
  },
  icons: (c, at, s) => ({
    title: str(c, `${at}.title`, s.title, 90),
    layout: pick(c, `${at}.layout`, s.layout, ['grid', 'list'] as const, 'grid'),
    items: items(c, `${at}.items`, s.items, 2, 6, (d, p) => ({
      icon: icon(c, `${p}.icon`, d.icon),
      label: str(c, `${p}.label`, d.label, 40, true),
      detail: str(c, `${p}.detail`, d.detail, 90),
    })),
  }),
  steps: (c, at, s) => ({
    title: str(c, `${at}.title`, s.title, 90),
    steps: items(c, `${at}.steps`, s.steps, 2, 5, (d, p) => ({
      title: str(c, `${p}.title`, d.title, 40, true),
      detail: str(c, `${p}.detail`, d.detail, 90),
      icon: icon(c, `${p}.icon`, d.icon),
    })),
  }),
  timeline: (c, at, s) => ({
    title: str(c, `${at}.title`, s.title, 90),
    events: items(c, `${at}.events`, s.events, 2, 6, (d, p) => ({
      date: str(c, `${p}.date`, d.date, 16, true),
      title: str(c, `${p}.title`, d.title, 40, true),
      detail: str(c, `${p}.detail`, d.detail, 90),
    })),
  }),
  compare: (c, at, s) => {
    const side = (name: 'left' | 'right'): Obj => {
      const raw = s[name];
      if (!isObj(raw)) {
        c.p.error(`${at}.${name}`, 'is required: { label, points[], icon? }');
        return {};
      }
      return {
        label: str(c, `${at}.${name}.label`, raw.label, 30, true),
        points: strs(c, `${at}.${name}.points`, raw.points, 1, 4, 60),
        icon: icon(c, `${at}.${name}.icon`, raw.icon),
      };
    };
    return {
      title: str(c, `${at}.title`, s.title, 90),
      left: side('left'),
      right: side('right'),
      verdict: str(c, `${at}.verdict`, s.verdict, 90),
    };
  },
  quote: (c, at, s) => ({
    quote: str(c, `${at}.quote`, s.quote, 220, true),
    author: str(c, `${at}.author`, s.author, 40),
    role: str(c, `${at}.role`, s.role, 60),
  }),
  image: (c, at, s) => ({
    image: image(c, `${at}.image`, s.image, true),
    headline: str(c, `${at}.headline`, s.headline, 90),
    caption: str(c, `${at}.caption`, s.caption, 160),
    motion: pick(c, `${at}.motion`, s.motion, CLIP_IMAGE_MOTIONS, 'zoom-in'),
  }),
  split: (c, at, s) => ({
    headline: str(c, `${at}.headline`, s.headline, 90, true),
    body: str(c, `${at}.body`, s.body, 220),
    bullets: strs(c, `${at}.bullets`, s.bullets, 0, 4, 60, false),
    image: image(c, `${at}.image`, s.image, false),
    icon: icon(c, `${at}.icon`, s.icon),
    side: pick(c, `${at}.side`, s.side, ['start', 'end'] as const, 'end'),
  }),
  list: (c, at, s) => ({
    title: str(c, `${at}.title`, s.title, 90, true),
    bullets: strs(c, `${at}.bullets`, s.bullets, 1, 6, 90),
    icon: icon(c, `${at}.icon`, s.icon),
  }),
  location: (c, at, s) => ({
    place: str(c, `${at}.place`, s.place, 40, true),
    region: str(c, `${at}.region`, s.region, 60),
    detail: str(c, `${at}.detail`, s.detail, 160),
    label: str(c, `${at}.label`, s.label, 40),
    icon: icon(c, `${at}.icon`, s.icon),
  }),
  cta: (c, at, s) => ({
    headline: str(c, `${at}.headline`, s.headline, 90, true),
    action: str(c, `${at}.action`, s.action, 40),
    url: str(c, `${at}.url`, s.url, 60),
    handle: str(c, `${at}.handle`, s.handle, 40),
  }),
  logo: (c, at, s) => ({
    image: image(c, `${at}.image`, s.image, false),
    text: str(c, `${at}.text`, s.text, 40),
    tagline: str(c, `${at}.tagline`, s.tagline, 90),
  }),
};

/** Drops undefined values and empty optional lists so the worker sees a clean scene. */
function prune(value: Obj): Obj {
  const out: Obj = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) {
      continue;
    }
    if (Array.isArray(inner) && inner.length === 0 && (key === 'emphasis' || key === 'bullets')) {
      if (key === 'bullets') {
        out[key] = inner;
      }
      continue;
    }
    out[key] = isObj(inner) ? prune(inner) : Array.isArray(inner) ? inner.map((v) => (isObj(v) ? prune(v) : v)) : inner;
  }
  return out;
}

/** Every visible string in the input, for language detection. */
function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => allText(v, out));
  } else if (isObj(value)) {
    Object.values(value).forEach((v) => allText(v, out));
  }
  return out;
}

/** Parses and validates the tool input into a clip request, or a list of precise errors. */
export function parseClipInput(
  input: Record<string, unknown>,
  config: TClipToolsConfig,
): ClipRequest | { errors: string[] } {
  const p = new Problems();
  const ctx: Ctx = { p, images: [], config };
  const notes: string[] = [];
  const title = str(ctx, 'title', input.title, 120, true);
  const rawTheme = input.theme;
  const theme = resolveClipTheme(rawTheme);
  if (typeof rawTheme === 'string' && rawTheme.trim() && rawTheme.trim().toLowerCase() !== theme) {
    notes.push(`theme "${rawTheme.slice(0, 40)}" is not offered any more; used ${theme}`);
  }
  const aspectRatio = pick(ctx, 'aspect_ratio', input.aspect_ratio, CLIP_ASPECT_RATIOS, '9:16');
  const brandName = str(ctx, 'brand_name', input.brand_name, 40) ?? 'HiveGPT';
  let brandColor: string | undefined;
  if (input.brand_color != null && input.brand_color !== '') {
    if (typeof input.brand_color === 'string' && HEX.test(input.brand_color.trim())) {
      brandColor = input.brand_color.trim();
    } else {
      p.error('brand_color', 'must be a hex color like #2ea884');
    }
  }
  const logo = input.logo_file_id
    ? image(ctx, 'logo_file_id', { source: 'file', file_id: input.logo_file_id }, false)
    : undefined;

  const rawScenes = arr(ctx, 'scenes', input.scenes, 1, config.maxScenes);
  const scenes: ClipScene[] = [];
  rawScenes.forEach((raw, i) => {
    const at = `scenes[${i}]`;
    if (!isObj(raw)) {
      p.error(at, 'must be an object');
      return;
    }
    const type = raw.type as ClipSceneType;
    if (!CLIP_SCENE_TYPES.includes(type)) {
      p.error(`${at}.type`, `must be one of ${CLIP_SCENE_TYPES.join(', ')}`);
      return;
    }
    const durationSec = num(ctx, `${at}.duration_sec`, raw.duration_sec, 1, 30, true) ?? 1;
    let accent: string | undefined;
    if (raw.accent != null && raw.accent !== '') {
      if (typeof raw.accent === 'string' && HEX.test(raw.accent)) {
        accent = raw.accent;
      } else {
        p.error(`${at}.accent`, 'must be a hex color like #ff8800');
      }
    }
    const scene = prune({
      type,
      durationSec: Math.round(durationSec * 10) / 10,
      transition: pick(ctx, `${at}.transition`, raw.transition, CLIP_TRANSITIONS, 'fade'),
      narration: str(ctx, `${at}.narration`, raw.narration, 600),
      accent,
      ...PARSERS[type](ctx, at, raw),
    });
    scenes.push(scene as ClipScene);
  });

  const aiCount = ctx.images.filter((img) => img.source === 'ai').length;
  if (aiCount > config.maxAiImages) {
    p.error('scenes', `at most ${config.maxAiImages} AI images per clip (got ${aiCount})`);
  }
  const stockCount = ctx.images.filter((img) => img.source === 'stock').length;
  if (stockCount > config.maxStockImages) {
    p.error('scenes', `at most ${config.maxStockImages} stock photos per clip (got ${stockCount})`);
  }

  const durationSec = Math.round(scenes.reduce((sum, s) => sum + s.durationSec, 0) * 10) / 10;
  if (durationSec > config.maxDurationSec) {
    p.error('scenes', `scene durations add up to ${durationSec}s; the limit is ${config.maxDurationSec}s`);
  }

  const lang =
    input.lang === 'fa' || input.lang === 'en'
      ? input.lang
      : PERSIAN.test(allText(input.scenes).join(' ') + (title ?? ''))
        ? 'fa'
        : 'en';

  const audioRaw = isObj(input.audio) ? input.audio : {};
  const mode = pick(ctx, 'audio.mode', audioRaw.mode, ['none', 'tts', 'upload'] as const, 'none');
  const fileId = str(ctx, 'audio.file_id', audioRaw.file_id, 100);
  if (mode === 'upload' && (!fileId || !FILE_ID.test(fileId))) {
    p.error('audio.file_id', 'audio.mode=upload needs the id of an audio file the user attached');
  }
  const voice = str(ctx, 'audio.voice', audioRaw.voice, 60);
  if (voice && !VOICE.test(voice)) {
    p.error('audio.voice', 'must be an Edge voice id like fa-IR-DilaraNeural or en-US-JennyNeural');
  }
  if (mode === 'tts') {
    if (!scenes.some((s) => typeof s.narration === 'string')) {
      p.error('scenes', 'audio.mode=tts needs a narration line on at least one scene');
    }
    const rate = CHARS_PER_SEC[lang];
    const spoken = scenes.reduce(
      (sum, s) => sum + Math.max(s.durationSec, String(s.narration ?? '').length / rate + 0.9),
      0,
    );
    if (spoken > config.maxDurationSec) {
      p.error(
        'scenes',
        `the narration needs about ${Math.round(spoken)}s but the limit is ${config.maxDurationSec}s; shorten the narration lines`,
      );
    }
  }

  let music: ClipStoryboard['music'];
  if (input.music != null && input.music !== 'none' && input.music !== '') {
    const track = pick(ctx, 'music', input.music, CLIP_MUSIC_TRACKS, 'ambient');
    const volume = num(ctx, 'music_volume', input.music_volume, 0, 1) ?? 0.22;
    if (!config.music) {
      notes.push('background music is off on this deployment; the clip has no music');
    } else {
      music = { track, volume };
    }
  }
  const captions = input.captions !== false && config.captions;

  if (p.errors.length > 0 || !title) {
    return { errors: p.errors.length ? p.errors : ['title: is required'] };
  }
  const version = Math.min(999, Math.max(1, Math.round(Number(input.version)) || 1));
  return {
    storyboard: {
      title,
      lang,
      aspectRatio,
      theme,
      brandName,
      ...(brandColor ? { brandColor } : {}),
      ...(logo ? { logo } : {}),
      captions,
      ...(music ? { music } : {}),
      scenes,
    },
    images: ctx.images,
    audio: { mode, ...(mode === 'upload' && fileId ? { fileId } : {}), ...(voice ? { voice } : {}) },
    durationSec,
    preview: input.preview === true,
    version,
    notes,
  };
}

/** Output size for an aspect ratio, short side `shortSide` (even numbers for x264). */
export function dimensionsFor(
  aspectRatio: ClipAspectRatio,
  shortSide: number,
): { width: number; height: number } {
  const s = Math.max(360, Math.min(1080, Math.round(shortSide / 2) * 2));
  const even = (n: number): number => Math.round(n / 2) * 2;
  switch (aspectRatio) {
    case '16:9':
      return { width: even((s * 16) / 9), height: s };
    case '1:1':
      return { width: s, height: s };
    case '4:5':
      return { width: s, height: even((s * 5) / 4) };
    default:
      return { width: s, height: even((s * 16) / 9) };
  }
}
