// Storyboard contract (version 2) between the HiveGPT api and this worker, validated strictly.
// The api sends a normalized camelCase storyboard; every scene carries its own typed fields.
// Validation returns precise errors (`scenes[2].data[1].value: must be a number`) and
// non-fatal warnings (unknown icon names, missing glyphs, legacy theme ids).
import { missingGlyphs } from './glyphs.mjs';
import { resolveIcon } from './icons.mjs';

export const FPS = 30;
export const HARD_MAX_DURATION_SEC = 180;
export const MAX_SCENES = 30;
export const SCENE_MIN_SEC = 1;
export const SCENE_MAX_SEC = 30;
export const TRANSITION_FRAMES = 15;
/** Narration starts this many frames into its scene (after the incoming transition settles). */
export const NARRATION_LEAD_FRAMES = 8;
/** Silence kept after a scene's narration before the next scene starts. */
export const NARRATION_TAIL_SEC = 0.6;

export const SCENE_TYPES = [
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
];
export const THEMES = ['midnight', 'aurora', 'daylight', 'sunset', 'editorial', 'neon'];
/** Pre-0.40 theme ids: brand shells map to the closest theme, chai style films to midnight. */
export const LEGACY_THEMES = {
  'brand-dark': 'midnight',
  'brand-light': 'daylight',
  ugc: 'editorial',
  chalkboard: 'midnight',
  'pixel-art': 'neon',
  'flat-vector': 'daylight',
  'woodblock-print': 'editorial',
  'cartoon-1930s': 'editorial',
  'brick-toy': 'sunset',
  'paper-cut': 'editorial',
  'paper-cutout': 'editorial',
  'maths-diagram': 'daylight',
  'cartoon-explainer': 'daylight',
  blueprint: 'midnight',
  watercolor: 'sunset',
  claymation: 'sunset',
};
export const ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9'];
export const TRANSITIONS = ['fade', 'slide', 'wipe', 'flip', 'clock-wipe', 'none'];
export const CHART_KINDS = ['bar', 'line', 'pie', 'donut'];
export const IMAGE_MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'still'];
export const MUSIC_TRACKS = ['ambient', 'pulse', 'cinematic'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;

class Problems {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(path, message) {
    if (this.errors.length < 12) {
      this.errors.push(`${path}: ${message}`);
    }
  }
  warn(message) {
    if (this.warnings.length < 40) {
      this.warnings.push(message);
    }
  }
}

const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

/** Required or optional trimmed string with a length cap. Returns undefined when absent. */
function text(p, path, value, { max, required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      p.error(path, 'is required');
    }
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    p.error(path, 'must be a string');
    return undefined;
  }
  const out = String(value).replace(/\s+/g, ' ').trim();
  if (!out) {
    if (required) {
      p.error(path, 'is required');
    }
    return undefined;
  }
  if (out.length > max) {
    p.error(path, `must be at most ${max} characters (got ${out.length})`);
    return undefined;
  }
  return out;
}

function number(p, path, value, { min = -1e15, max = 1e15, required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      p.error(path, 'is required');
    }
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) {
    p.error(path, 'must be a number');
    return undefined;
  }
  if (n < min || n > max) {
    p.error(path, `must be between ${min} and ${max}`);
    return undefined;
  }
  return n;
}

function oneOf(p, path, value, options, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  if (!options.includes(value)) {
    p.error(path, `must be one of ${options.join(', ')}`);
    return fallback;
  }
  return value;
}

function list(p, path, value, { min, max, required = true }) {
  if (value == null) {
    if (required) {
      p.error(path, `is required (${min}-${max} items)`);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    p.error(path, 'must be an array');
    return [];
  }
  if (value.length < min || value.length > max) {
    p.error(path, `must have ${min}-${max} items (got ${value.length})`);
    return [];
  }
  return value;
}

function icon(p, path, value, icons) {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    p.error(path, 'must be an icon name string');
    return undefined;
  }
  const resolved = resolveIcon(value);
  if (!resolved.known) {
    p.warn(`unknown_icon: ${path} "${value.slice(0, 40)}" -> ${resolved.name}`);
  }
  icons.add(resolved.name);
  return resolved.name;
}

function asset(p, path, value, assets, kind = 'image') {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !ASSET_ID.test(value)) {
    p.error(path, 'must be an asset id');
    return undefined;
  }
  const entry = assets[value];
  if (!entry) {
    p.error(path, `asset "${value}" was not sent with the job`);
    return undefined;
  }
  if (entry.kind !== kind) {
    p.error(path, `asset "${value}" is not an ${kind}`);
    return undefined;
  }
  return value;
}

const strings = (p, path, value, { min, max, maxChars, required = true }) =>
  list(p, path, value, { min, max, required })
    .map((item, i) => text(p, `${path}[${i}]`, item, { max: maxChars, required: true }))
    .filter((item) => item != null);

/** Per-type field parsers. Each returns the typed scene fields (without the shared ones). */
const PARSERS = {
  hook(p, at, s, ctx) {
    const headline = text(p, `${at}.headline`, s.headline, { max: 90, required: true });
    const emphasis = strings(p, `${at}.emphasis`, s.emphasis, {
      min: 0,
      max: 4,
      maxChars: 30,
      required: false,
    });
    return {
      headline,
      subline: text(p, `${at}.subline`, s.subline, { max: 160 }),
      kicker: text(p, `${at}.kicker`, s.kicker, { max: 40 }),
      emphasis,
      icon: icon(p, `${at}.icon`, s.icon, ctx.icons),
    };
  },
  stat(p, at, s, ctx) {
    return {
      value: number(p, `${at}.value`, s.value, { required: true }),
      decimals: number(p, `${at}.decimals`, s.decimals, { min: 0, max: 2 }) ?? 0,
      prefix: text(p, `${at}.prefix`, s.prefix, { max: 6 }),
      suffix: text(p, `${at}.suffix`, s.suffix, { max: 12 }),
      label: text(p, `${at}.label`, s.label, { max: 90, required: true }),
      caption: text(p, `${at}.caption`, s.caption, { max: 160 }),
      icon: icon(p, `${at}.icon`, s.icon, ctx.icons),
    };
  },
  chart(p, at, s) {
    const chart = oneOf(p, `${at}.chart`, s.chart, CHART_KINDS, 'bar');
    const data = list(p, `${at}.data`, s.data, { min: 2, max: 8 }).map((point, i) => {
      const path = `${at}.data[${i}]`;
      if (!isObject(point)) {
        p.error(path, 'must be an object with label and value');
        return { label: '', value: 0 };
      }
      const value = number(p, `${path}.value`, point.value, {
        required: true,
        min: chart === 'pie' || chart === 'donut' ? 0 : -1e15,
      });
      return {
        label: text(p, `${path}.label`, point.label, { max: 24, required: true }) ?? '',
        value: value ?? 0,
      };
    });
    if ((chart === 'pie' || chart === 'donut') && data.length && data.every((d) => d.value === 0)) {
      p.error(`${at}.data`, 'a pie or donut chart needs at least one value above 0');
    }
    const highlight = number(p, `${at}.highlight`, s.highlight, { min: 0, max: 7 });
    if (highlight != null && highlight >= data.length) {
      p.error(`${at}.highlight`, 'must be the index of a data point');
    }
    return {
      chart,
      title: text(p, `${at}.title`, s.title, { max: 90 }),
      unit: text(p, `${at}.unit`, s.unit, { max: 12 }),
      caption: text(p, `${at}.caption`, s.caption, { max: 160 }),
      data,
      highlight: highlight != null ? Math.round(highlight) : undefined,
    };
  },
  icons(p, at, s, ctx) {
    return {
      title: text(p, `${at}.title`, s.title, { max: 90 }),
      layout: oneOf(p, `${at}.layout`, s.layout, ['grid', 'list'], 'grid'),
      items: list(p, `${at}.items`, s.items, { min: 2, max: 6 }).map((item, i) => {
        const path = `${at}.items[${i}]`;
        if (!isObject(item)) {
          p.error(path, 'must be an object with icon and label');
          return { icon: 'sparkles', label: '' };
        }
        return {
          icon: icon(p, `${path}.icon`, item.icon ?? 'sparkles', ctx.icons),
          label: text(p, `${path}.label`, item.label, { max: 40, required: true }) ?? '',
          detail: text(p, `${path}.detail`, item.detail, { max: 90 }),
        };
      }),
    };
  },
  steps(p, at, s, ctx) {
    return {
      title: text(p, `${at}.title`, s.title, { max: 90 }),
      steps: list(p, `${at}.steps`, s.steps, { min: 2, max: 5 }).map((item, i) => {
        const path = `${at}.steps[${i}]`;
        if (!isObject(item)) {
          p.error(path, 'must be an object with a title');
          return { title: '' };
        }
        return {
          title: text(p, `${path}.title`, item.title, { max: 40, required: true }) ?? '',
          detail: text(p, `${path}.detail`, item.detail, { max: 90 }),
          icon: icon(p, `${path}.icon`, item.icon, ctx.icons),
        };
      }),
    };
  },
  timeline(p, at, s) {
    return {
      title: text(p, `${at}.title`, s.title, { max: 90 }),
      events: list(p, `${at}.events`, s.events, { min: 2, max: 6 }).map((item, i) => {
        const path = `${at}.events[${i}]`;
        if (!isObject(item)) {
          p.error(path, 'must be an object with date and title');
          return { date: '', title: '' };
        }
        return {
          date: text(p, `${path}.date`, item.date, { max: 16, required: true }) ?? '',
          title: text(p, `${path}.title`, item.title, { max: 40, required: true }) ?? '',
          detail: text(p, `${path}.detail`, item.detail, { max: 90 }),
        };
      }),
    };
  },
  compare(p, at, s, ctx) {
    const side = (name) => {
      const path = `${at}.${name}`;
      const raw = s[name];
      if (!isObject(raw)) {
        p.error(path, 'is required: { label, points[], icon? }');
        return { label: '', points: [] };
      }
      return {
        label: text(p, `${path}.label`, raw.label, { max: 30, required: true }) ?? '',
        points: strings(p, `${path}.points`, raw.points, { min: 1, max: 4, maxChars: 60 }),
        icon: icon(p, `${path}.icon`, raw.icon, ctx.icons),
      };
    };
    return {
      title: text(p, `${at}.title`, s.title, { max: 90 }),
      left: side('left'),
      right: side('right'),
      verdict: text(p, `${at}.verdict`, s.verdict, { max: 90 }),
    };
  },
  quote(p, at, s) {
    return {
      quote: text(p, `${at}.quote`, s.quote, { max: 220, required: true }),
      author: text(p, `${at}.author`, s.author, { max: 40 }),
      role: text(p, `${at}.role`, s.role, { max: 60 }),
    };
  },
  image(p, at, s, ctx) {
    return {
      image: asset(p, `${at}.image`, s.image, ctx.assets) ?? requiredAsset(p, `${at}.image`, s.image),
      headline: text(p, `${at}.headline`, s.headline, { max: 90 }),
      caption: text(p, `${at}.caption`, s.caption, { max: 160 }),
      motion: oneOf(p, `${at}.motion`, s.motion, IMAGE_MOTIONS, 'zoom-in'),
    };
  },
  split(p, at, s, ctx) {
    const image = asset(p, `${at}.image`, s.image, ctx.assets);
    return {
      headline: text(p, `${at}.headline`, s.headline, { max: 90, required: true }),
      body: text(p, `${at}.body`, s.body, { max: 220 }),
      bullets: strings(p, `${at}.bullets`, s.bullets, {
        min: 0,
        max: 4,
        maxChars: 60,
        required: false,
      }),
      image,
      icon: image ? undefined : icon(p, `${at}.icon`, s.icon ?? 'sparkles', ctx.icons),
      side: oneOf(p, `${at}.side`, s.side, ['start', 'end'], 'end'),
    };
  },
  list(p, at, s, ctx) {
    return {
      title: text(p, `${at}.title`, s.title, { max: 90, required: true }),
      bullets: strings(p, `${at}.bullets`, s.bullets, { min: 1, max: 6, maxChars: 90 }),
      icon: icon(p, `${at}.icon`, s.icon, ctx.icons),
    };
  },
  location(p, at, s, ctx) {
    return {
      place: text(p, `${at}.place`, s.place, { max: 40, required: true }),
      region: text(p, `${at}.region`, s.region, { max: 60 }),
      detail: text(p, `${at}.detail`, s.detail, { max: 160 }),
      label: text(p, `${at}.label`, s.label, { max: 40 }),
      icon: icon(p, `${at}.icon`, s.icon ?? 'map-pin', ctx.icons),
    };
  },
  cta(p, at, s) {
    return {
      headline: text(p, `${at}.headline`, s.headline, { max: 90, required: true }),
      action: text(p, `${at}.action`, s.action, { max: 40 }),
      url: text(p, `${at}.url`, s.url, { max: 60 }),
      handle: text(p, `${at}.handle`, s.handle, { max: 40 }),
    };
  },
  logo(p, at, s, ctx) {
    const image = asset(p, `${at}.image`, s.image, ctx.assets);
    const label = text(p, `${at}.text`, s.text, { max: 40 });
    return {
      image,
      text: label ?? (image ? undefined : ctx.brandName),
      tagline: text(p, `${at}.tagline`, s.tagline, { max: 90 }),
    };
  },
};

function requiredAsset(p, path, value) {
  if (value == null || value === '') {
    p.error(path, 'is required: an image asset id');
  }
  return undefined;
}

/** Every visible string of a scene (for the glyph check). */
function sceneStrings(scene) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      out.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isObject(value)) {
      for (const [key, inner] of Object.entries(value)) {
        if (!['type', 'transition', 'icon', 'image', 'chart', 'layout', 'motion', 'side', 'id'].includes(key)) {
          walk(inner);
        }
      }
    }
  };
  walk(scene);
  return out;
}

const PERSIAN = /[\u0600-\u06FF]/;

/**
 * Validate a storyboard. `assets` is the map of ids the job carried ({ id: { kind } }).
 * @returns {{ ok: true, storyboard, icons: string[], warnings: string[] } | { ok: false, errors: string[], warnings: string[] }}
 */
export function validateStoryboard(input, { assets = {}, maxDurationSec = 90 } = {}) {
  const p = new Problems();
  if (!isObject(input)) {
    return { ok: false, errors: ['storyboard: must be an object'], warnings: [] };
  }
  const cap = Math.min(HARD_MAX_DURATION_SEC, Math.max(5, Number(maxDurationSec) || 90));
  const title = text(p, 'title', input.title, { max: 120, required: true });
  const brandName = text(p, 'brandName', input.brandName, { max: 40 }) ?? 'HiveGPT';

  let theme = input.theme ?? 'midnight';
  if (!THEMES.includes(theme)) {
    const mapped = LEGACY_THEMES[theme] ?? 'midnight';
    p.warn(`unknown_theme: "${String(theme).slice(0, 40)}" -> ${mapped}`);
    theme = mapped;
  }
  const aspectRatio = oneOf(p, 'aspectRatio', input.aspectRatio, ASPECT_RATIOS, '9:16');
  let brandColor;
  if (input.brandColor != null && input.brandColor !== '') {
    if (typeof input.brandColor === 'string' && HEX.test(input.brandColor)) {
      brandColor = input.brandColor;
    } else {
      p.error('brandColor', 'must be a hex color like #2ea884');
    }
  }
  const icons = new Set();
  const ctx = { icons, assets: isObject(assets) ? assets : {}, brandName };
  const logo = asset(p, 'logo', input.logo, ctx.assets);

  const rawScenes = list(p, 'scenes', input.scenes, { min: 1, max: MAX_SCENES });
  const scenes = [];
  rawScenes.forEach((raw, i) => {
    const at = `scenes[${i}]`;
    if (!isObject(raw)) {
      p.error(at, 'must be an object');
      return;
    }
    const type = raw.type;
    if (!SCENE_TYPES.includes(type)) {
      p.error(`${at}.type`, `must be one of ${SCENE_TYPES.join(', ')}`);
      return;
    }
    const durationSec = number(p, `${at}.durationSec`, raw.durationSec, {
      min: SCENE_MIN_SEC,
      max: SCENE_MAX_SEC,
      required: true,
    });
    const transition = oneOf(p, `${at}.transition`, raw.transition, TRANSITIONS, 'fade');
    const narration = text(p, `${at}.narration`, raw.narration, { max: 600 });
    let accent;
    if (raw.accent != null && raw.accent !== '') {
      if (typeof raw.accent === 'string' && HEX.test(raw.accent)) {
        accent = raw.accent;
      } else {
        p.error(`${at}.accent`, 'must be a hex color like #ff8800');
      }
    }
    const fields = PARSERS[type](p, at, raw, ctx);
    scenes.push(
      prune({
        id: `s${i}`,
        type,
        durationSec: durationSec ?? SCENE_MIN_SEC,
        transition,
        narration,
        accent,
        ...fields,
      }),
    );
  });

  const total = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (total > cap) {
    p.error('scenes', `scene durations add up to ${round1(total)}s; the limit is ${cap}s`);
  }

  const allText = [title ?? '', brandName, ...scenes.flatMap(sceneStrings)].join(' ');
  const lang = input.lang === 'fa' || input.lang === 'en' ? input.lang : PERSIAN.test(allText) ? 'fa' : 'en';
  const missing = missingGlyphs(allText);
  if (missing.length) {
    p.warn(`missing_glyphs: ${missing.slice(0, 12).join(' ')}`);
  }

  const captions = input.captions !== false;
  let music;
  if (isObject(input.music)) {
    const track = oneOf(p, 'music.track', input.music.track, [...MUSIC_TRACKS, 'none'], 'none');
    const volume = number(p, 'music.volume', input.music.volume, { min: 0, max: 1 }) ?? 0.22;
    if (track !== 'none') {
      music = { track, volume };
    }
  } else if (input.music != null) {
    p.error('music', 'must be { track, volume? }');
  }

  if (p.errors.length) {
    return { ok: false, errors: p.errors, warnings: p.warnings };
  }
  return {
    ok: true,
    storyboard: prune({
      version: 2,
      title,
      lang,
      aspectRatio,
      theme,
      brandName,
      brandColor,
      logo,
      captions,
      music,
      scenes,
    }),
    icons: [...icons],
    warnings: p.warnings,
  };
}

function prune(value) {
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined || (Array.isArray(inner) && inner.length === 0 && key === 'emphasis')) {
      continue;
    }
    out[key] = inner;
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Output size for an aspect ratio: the short side is `shortSide` px (even numbers for x264). */
export function dimensionsFor(aspectRatio, shortSide = 720) {
  const s = Math.max(360, Math.min(1080, Math.round(shortSide / 2) * 2));
  const even = (n) => Math.round(n / 2) * 2;
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

/**
 * Frame timeline for TransitionSeries. Scene i is on screen from `from` for `frames`; its
 * sequence also covers the outgoing transition (`seqFrames = frames + transitionOut`) so the
 * total length equals the sum of scene lengths.
 */
export function computeTimeline(scenes, fps = FPS) {
  let from = 0;
  const out = scenes.map((scene, i) => {
    const frames = Math.max(fps, Math.round(scene.durationSec * fps));
    const next = scenes[i + 1];
    const transitionOut = next && next.transition !== 'none' ? TRANSITION_FRAMES : 0;
    const entry = { from, frames, seqFrames: frames + transitionOut, transitionOut };
    from += frames;
    return entry;
  });
  return { scenes: out, totalFrames: Math.max(fps, from) };
}
