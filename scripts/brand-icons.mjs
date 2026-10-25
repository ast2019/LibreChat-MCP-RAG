#!/usr/bin/env node
/**
 * Renders the favicon and app icons from client/public/assets/logo.svg.
 * Run from the repository root after changing the logo: `node scripts/brand-icons.mjs`.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const assets = path.resolve(import.meta.dirname, '../client/public/assets');
const logo = await readFile(path.join(assets, 'logo.svg'));

/** The logo at `size`, centered on a `canvas` square with an optional solid background. */
async function render(file, { canvas, size = canvas, background }) {
  const mark = await sharp(logo, { density: 384 }).resize(size, size).png().toBuffer();
  const offset = Math.round((canvas - size) / 2);
  await sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(assets, file));
  console.log(`wrote ${file}`);
}

await render('favicon-16x16.png', { canvas: 16 });
await render('favicon-32x32.png', { canvas: 32 });
await render('icon-192x192.png', { canvas: 192 });
/** iOS paints transparent pixels black, so the touch icon carries its own background */
await render('apple-touch-icon-180x180.png', {
  canvas: 180,
  size: 148,
  background: { r: 255, g: 251, b: 235, alpha: 1 },
});
/** Maskable icons are cropped to a circle or squircle; the mark stays inside the 80% safe zone */
await render('maskable-icon.png', {
  canvas: 512,
  size: 360,
  background: { r: 255, g: 251, b: 235, alpha: 1 },
});
