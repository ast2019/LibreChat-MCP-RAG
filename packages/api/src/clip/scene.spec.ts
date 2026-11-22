import { clipToolsSchema } from 'librechat-data-provider';
import { dimensionsFor, parseClipInput } from './scene';
import type { ClipRequest } from './scene';

const config = clipToolsSchema.parse({});
const ok = (input: Record<string, unknown>, cfg = config): ClipRequest => {
  const parsed = parseClipInput(input, cfg);
  if ('errors' in parsed) {
    throw new Error(parsed.errors.join('\n'));
  }
  return parsed;
};
const errors = (input: Record<string, unknown>, cfg = config): string[] => {
  const parsed = parseClipInput(input, cfg);
  return 'errors' in parsed ? parsed.errors : [];
};

describe('parseClipInput (storyboard v2)', () => {
  it('normalizes typed scenes into the worker shape', () => {
    const request = ok({
      title: 'انرژی',
      aspect_ratio: '9:16',
      theme: 'aurora',
      music: 'ambient',
      audio: { mode: 'tts', voice: 'fa-IR-FaridNeural' },
      scenes: [
        { type: 'hook', duration_sec: 4, headline: 'انرژی خورشیدی', emphasis: ['خورشیدی'], narration: 'سلام' },
        { type: 'chart', duration_sec: 5, chart: 'donut', data: [{ label: 'a', value: 60 }, { label: 'b', value: 40 }], highlight: 0 },
        { type: 'image', duration_sec: 3, image: { source: 'file', file_id: 'file-123456' }, motion: 'pan-left' },
      ],
    });
    expect(request.storyboard).toMatchObject({ lang: 'fa', theme: 'aurora', aspectRatio: '9:16', captions: true, music: { track: 'ambient', volume: 0.22 } });
    expect(request.storyboard.scenes[0]).toEqual({
      type: 'hook',
      durationSec: 4,
      transition: 'fade',
      narration: 'سلام',
      headline: 'انرژی خورشیدی',
      emphasis: ['خورشیدی'],
    });
    expect(request.storyboard.scenes[2].image).toBe('img0');
    expect(request.images).toEqual([{ id: 'img0', source: 'file', fileId: 'file-123456' }]);
    expect(request.durationSec).toBe(12);
    expect(request.audio).toEqual({ mode: 'tts', voice: 'fa-IR-FaridNeural' });
  });

  it('returns precise field paths for invalid scenes', () => {
    const list = errors({
      title: 'x',
      scenes: [
        { type: 'chart', duration_sec: 3, chart: 'pie', data: [{ label: 'a', value: 'ten' }, { label: 'b', value: -2 }] },
        { type: 'stat', duration_sec: 40, label: 'x' },
        { type: 'title', duration_sec: 3 },
        { type: 'compare', duration_sec: 3, left: { label: 'A', points: [] } },
      ],
    }).join('\n');
    expect(list).toContain('scenes[0].data[0].value: must be a number');
    expect(list).toContain('scenes[0].data[1].value: must be between 0');
    expect(list).toContain('scenes[1].duration_sec: must be between 1 and 30');
    expect(list).toContain('scenes[1].value: is required');
    expect(list).toContain('scenes[2].type: must be one of hook, stat');
    expect(list).toContain('scenes[3].left.points: must have 1-4 items');
    expect(list).toContain('scenes[3].right: is required');
  });

  it('enforces the configured length, scene count and narration fit', () => {
    const long = Array.from({ length: 4 }, () => ({ type: 'hook', duration_sec: 30, headline: 'a' }));
    expect(errors({ title: 't', scenes: long }).join()).toContain('add up to 120s; the limit is 90s');
    expect(ok({ title: 't', scenes: long }, { ...config, maxDurationSec: 180 }).durationSec).toBe(120);
    const many = Array.from({ length: 21 }, () => ({ type: 'hook', duration_sec: 1, headline: 'a' }));
    expect(errors({ title: 't', scenes: many }).join()).toContain('scenes: must have 1-20 items');
    const wordy = {
      title: 't',
      audio: { mode: 'tts' },
      scenes: [{ type: 'hook', duration_sec: 5, headline: 'a', narration: 'word '.repeat(119) + 'end' }],
    };
    expect(errors(wordy, { ...config, maxDurationSec: 30 }).join()).toContain('shorten the narration');
    expect(errors({ title: 't', audio: { mode: 'tts' }, scenes: [{ type: 'hook', duration_sec: 2, headline: 'a' }] }).join()).toContain(
      'needs a narration line',
    );
  });

  it('keeps AI images opt-in and capped, and stock photos capped', () => {
    const scene = (i: number) => ({ type: 'image', duration_sec: 2, image: { source: 'ai', prompt: `p${i}` } });
    expect(errors({ title: 't', scenes: [scene(0)] }).join()).toContain('AI images are turned off');
    const on = { ...config, aiImages: true, maxAiImages: 2 };
    expect(ok({ title: 't', scenes: [scene(0), scene(1)] }, on).images.map((i) => i.source)).toEqual(['ai', 'ai']);
    expect(errors({ title: 't', scenes: [scene(0), scene(1), scene(2)] }, on).join()).toContain('at most 2 AI images');
    const stock = { type: 'image', duration_sec: 2, image: { source: 'stock', query: 'wind farm' } };
    expect(ok({ title: 't', scenes: [stock] }).images[0]).toEqual({ id: 'img0', source: 'stock', query: 'wind farm' });
  });

  it('maps legacy theme ids with a note and detects the language', () => {
    const request = ok({ title: 'Clip', theme: 'claymation', scenes: [{ type: 'hook', duration_sec: 2, headline: 'Hello' }] });
    expect(request.storyboard.theme).toBe('sunset');
    expect(request.notes[0]).toContain('not offered any more');
    expect(request.storyboard.lang).toBe('en');
    expect(ok({ title: 'Clip', theme: 'brand-dark', scenes: [{ type: 'hook', duration_sec: 2, headline: 'a' }] }).storyboard.theme).toBe('midnight');
  });

  it('rejects bad audio, voices and colours', () => {
    const base = { title: 't', scenes: [{ type: 'hook', duration_sec: 2, headline: 'a' }] };
    expect(errors({ ...base, audio: { mode: 'upload' } }).join()).toContain('audio.file_id');
    expect(errors({ ...base, audio: { mode: 'none', voice: 'robot' } }).join()).toContain('audio.voice');
    expect(errors({ ...base, brand_color: 'green' }).join()).toContain('brand_color');
  });
});

describe('dimensionsFor', () => {
  it('uses the short side for every aspect ratio', () => {
    expect(dimensionsFor('9:16', 720)).toEqual({ width: 720, height: 1280 });
    expect(dimensionsFor('16:9', 720)).toEqual({ width: 1280, height: 720 });
    expect(dimensionsFor('1:1', 720)).toEqual({ width: 720, height: 720 });
    expect(dimensionsFor('4:5', 720)).toEqual({ width: 720, height: 900 });
  });
});
