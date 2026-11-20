import fs from 'node:fs';
import path from 'node:path';
import { CLIP_THEMES } from './themes';
import {
  STYLE_FILM_3D_MAX_SEC,
  STYLE_FILM_3D_THEMES,
  STYLE_FILM_MAX_SEC,
  STYLE_FILM_THEMES,
} from './styleFilms';

const root = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function setBody(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!match) {
    throw new Error(`${name} not found`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('theme lists match the Remotion worker (drift guard)', () => {
  const server = read('deploy/remotion/src/server.mjs');

  it('THEMES equals CLIP_THEMES', () => {
    expect(setBody(server, 'THEMES').sort()).toEqual([...CLIP_THEMES].sort());
  });

  it('STYLE_FILM_THEMES equals the API set', () => {
    expect(setBody(server, 'STYLE_FILM_THEMES').sort()).toEqual([...STYLE_FILM_THEMES].sort());
  });

  it('themeMap.ts keys equal CLIP_THEMES', () => {
    const source = read('deploy/remotion/src/themeMap.ts');
    const body = /THEME_STYLE_ID[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    const keys = [...body.matchAll(/^\s*'?([A-Za-z0-9-]+)'?:/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...CLIP_THEMES].sort());
  });

  it('3D themes and caps equal the worker constants', () => {
    expect(setBody(server, 'THEMES_3D').sort()).toEqual([...STYLE_FILM_3D_THEMES].sort());
    expect(server).toMatch(new RegExp(`'REMOTION_STYLE_FILM_MAX_SEC', ${STYLE_FILM_MAX_SEC},`));
    expect(server).toMatch(
      new RegExp(`'REMOTION_STYLE_FILM_3D_MAX_SEC', ${STYLE_FILM_3D_MAX_SEC},`),
    );
  });
});
