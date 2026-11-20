import { clipToolsSchema } from 'librechat-data-provider';
import { STYLE_FILM_3D_MAX_SEC, STYLE_FILM_MAX_SEC } from './styleFilms';
import { dimensionsFor, narrationTextFromSpec, parseClipInput } from './scene';

const config = clipToolsSchema.parse({});

describe('parseClipInput', () => {
  it('parses a minimal title scene', () => {
    const spec = parseClipInput(
      {
        title: 'فروش پاییز',
        scenes: [{ type: 'title', duration_sec: 5, heading: 'شروع' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(spec).toMatchObject({
      title: 'فروش پاییز',
      durationSec: 5,
      aspectRatio: '9:16',
      theme: 'brand-dark',
      brandName: 'HiveGPT',
      audio: { mode: 'none' },
      version: 1,
    });
  });

  it('accepts catalog style-film themes and paper-cut alias', () => {
    const chalk = parseClipInput(
      {
        title: 'board',
        theme: 'chalkboard',
        scenes: [{ type: 'title', duration_sec: 4, heading: 'Focus' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(chalk).toMatchObject({ theme: 'chalkboard' });
    const clay = parseClipInput(
      {
        title: 'clay',
        theme: 'claymation',
        scenes: [{ type: 'bullets', duration_sec: 5, heading: 'Shape', bullets: ['a', 'b'] }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(clay).toMatchObject({ theme: 'claymation' });
    const aliased = parseClipInput(
      {
        title: 'paper',
        theme: 'paper-cutout',
        scenes: [{ type: 'title', duration_sec: 3, heading: 'Cut' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(aliased).toMatchObject({ theme: 'paper-cut' });
    const unknown = parseClipInput(
      {
        title: 'gone',
        theme: 'synthwave',
        scenes: [{ type: 'title', duration_sec: 3, heading: 'Glow' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(unknown).toMatchObject({ theme: 'brand-dark' });
  });

  it('requires upload file_id and clamps duration to 30s', () => {
    expect(
      parseClipInput(
        {
          title: 'a',
          scenes: [{ type: 'title', duration_sec: 40, heading: 'x' }],
          audio: { mode: 'upload' },
        },
        config,
      ),
    ).toMatch(/audio\.file_id/);
    const long = parseClipInput(
      {
        title: 'a',
        duration_sec: 60,
        scenes: [
          { type: 'title', duration_sec: 20, heading: 'a' },
          { type: 'closing', duration_sec: 20, heading: 'b' },
        ],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(typeof long === 'object' && long.durationSec).toBe(30);
  });
});

describe('dimensionsFor / narrationTextFromSpec', () => {
  it('maps 9:16 and 16:9 at the configured height', () => {
    expect(dimensionsFor('9:16', 720)).toEqual({ width: 405, height: 720 });
    expect(dimensionsFor('16:9', 720)).toEqual({ width: 1280, height: 720 });
  });

  it('uses 1080×1350 for full style films', () => {
    expect(dimensionsFor('9:16', 720, 'claymation')).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsFor('16:9', 720, 'brand-dark')).toEqual({ width: 1280, height: 720 });
  });

  const styleInput = (theme: string, sceneSec: number[], extra: Record<string, unknown> = {}) => ({
    title: 'style',
    theme,
    scenes: sceneSec.map((duration_sec) => ({ type: 'title', duration_sec, heading: 'a' })),
    audio: { mode: 'none' },
    ...extra,
  });

  it('clamps 3D style films to the 3D cap and others to the style-film cap', () => {
    const clay = parseClipInput(styleInput('claymation', [10, 10], { duration_sec: 20 }), config);
    expect(clay).toMatchObject({ theme: 'claymation', durationSec: STYLE_FILM_3D_MAX_SEC });
    const chalk = parseClipInput(styleInput('chalkboard', [10, 10], { duration_sec: 20 }), config);
    expect(chalk).toMatchObject({ theme: 'chalkboard', durationSec: STYLE_FILM_MAX_SEC });
  });

  it('keeps a short style-film length instead of forcing 5s', () => {
    expect(parseClipInput(styleInput('chalkboard', [3, 4]), config)).toMatchObject({
      durationSec: 7,
    });
  });

  it('never exceeds the deployment max duration for style films', () => {
    const small = { ...config, maxDurationSec: 8 };
    expect(parseClipInput(styleInput('chalkboard', [10]), small)).toMatchObject({
      durationSec: 8,
    });
  });

  it('joins scene text for TTS when tts_text is absent', () => {
    const spec = parseClipInput(
      {
        title: 't',
        scenes: [
          { type: 'title', duration_sec: 3, heading: 'سلام', body: 'دنیا' },
          { type: 'bullets', duration_sec: 3, bullets: ['یک', 'دو'] },
        ],
        audio: { mode: 'tts' },
      },
      config,
    );
    expect(typeof spec).toBe('object');
    if (typeof spec === 'string') {
      return;
    }
    expect(narrationTextFromSpec(spec)).toContain('سلام');
    expect(narrationTextFromSpec(spec)).toContain('یک');
  });
});
