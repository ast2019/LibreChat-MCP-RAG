import { clipToolsSchema } from 'librechat-data-provider';
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

  it('accepts Claude animation style themes and aliases', () => {
    const spec = parseClipInput(
      {
        title: 'orbit',
        theme: 'dan-koe',
        scenes: [{ type: 'title', duration_sec: 4, heading: 'Focus' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(spec).toMatchObject({ theme: 'dan-koe' });
    const comic = parseClipInput(
      {
        title: 'boom',
        theme: 'comic-art',
        scenes: [{ type: 'bullets', duration_sec: 5, heading: 'Pow', bullets: ['a', 'b'] }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(comic).toMatchObject({ theme: 'comic-art' });
    const aliased = parseClipInput(
      {
        title: 'neon',
        theme: 'neon-synth',
        scenes: [{ type: 'title', duration_sec: 3, heading: 'Glow' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(aliased).toMatchObject({ theme: 'synthwave' });
    const sumi = parseClipInput(
      {
        title: 'ink',
        theme: 'sumi-ink',
        scenes: [{ type: 'title', duration_sec: 3, heading: 'Ink' }],
        audio: { mode: 'none' },
      },
      config,
    );
    expect(sumi).toMatchObject({ theme: 'sumi-ink' });
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
