import fs from 'node:fs';
import path from 'node:path';
import { CLIP_HARD_MAX_DURATION_SEC } from 'librechat-data-provider';
import {
  CLIP_CHARTS,
  CLIP_SCENE_TYPES,
  CLIP_TRANSITIONS,
  CLIP_MUSIC_TRACKS,
  CLIP_ASPECT_RATIOS,
  CLIP_IMAGE_MOTIONS,
} from './scene';
import { CLIP_THEMES, CLIP_THEME_ALIASES } from './themes';

const root = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** The string list of `export const NAME = [...]` in the worker's storyboard module. */
function list(source: string, name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) {
    throw new Error(`${name} not found`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('storyboard contract matches the Remotion worker (drift guard)', () => {
  const worker = read('deploy/remotion/src/storyboard.mjs');

  it.each([
    ['SCENE_TYPES', CLIP_SCENE_TYPES],
    ['THEMES', CLIP_THEMES],
    ['ASPECT_RATIOS', CLIP_ASPECT_RATIOS],
    ['TRANSITIONS', CLIP_TRANSITIONS],
    ['CHART_KINDS', CLIP_CHARTS],
    ['IMAGE_MOTIONS', CLIP_IMAGE_MOTIONS],
    ['MUSIC_TRACKS', CLIP_MUSIC_TRACKS],
  ])('%s', (name, values) => {
    expect(list(worker, name)).toEqual([...values]);
  });

  it('legacy theme ids map the same way on both sides', () => {
    const body = /export const LEGACY_THEMES = \{([\s\S]*?)\};/.exec(worker)?.[1] ?? '';
    const pairs = Object.fromEntries(
      [...body.matchAll(/'?([a-z0-9-]+)'?: '([a-z]+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(pairs).toEqual(CLIP_THEME_ALIASES);
  });

  it('the hard length cap agrees', () => {
    expect(worker).toContain(`export const HARD_MAX_DURATION_SEC = ${CLIP_HARD_MAX_DURATION_SEC};`);
  });

  it('every theme has a design in the composition', () => {
    const themes = read('deploy/remotion/src/studio/themes.ts');
    for (const id of CLIP_THEMES) {
      expect(themes).toContain(`  ${id}: {`);
    }
  });

  it('the bundled music tracks exist', () => {
    for (const track of CLIP_MUSIC_TRACKS) {
      expect(fs.existsSync(path.join(root, `deploy/remotion/public/music/${track}.mp3`))).toBe(true);
    }
  });
});
