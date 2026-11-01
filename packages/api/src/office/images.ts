import sharp from 'sharp';

/** An image ready for an Office file: PNG when it has transparency, JPEG otherwise. */
export interface PreparedImage {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

/** Large enough for a full slide or page at print quality, small enough to keep files light. */
const MAX_SIDE = 2000;
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Re-encodes an image for Word and PowerPoint, which cannot show WebP or AVIF: turned upright
 * from its EXIF orientation, scaled down to at most 2000 pixels a side, and written as PNG when it
 * has transparency (logos) or as JPEG (photos). Throws when the bytes are not an image.
 */
export async function prepareImage(buffer: Buffer): Promise<PreparedImage> {
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const metadata = await image.metadata();
  const resized = image.resize({
    width: MAX_SIDE,
    height: MAX_SIDE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const transparent = metadata.hasAlpha === true;
  const { data, info } = transparent
    ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await resized
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
  return { data, type: transparent ? 'png' : 'jpg', width: info.width, height: info.height };
}

/** The image cut to an aspect ratio (width over height) around its center, for a frame it fills. */
export async function cropToAspect(image: PreparedImage, aspect: number): Promise<PreparedImage> {
  const current = image.width / image.height;
  if (!Number.isFinite(aspect) || aspect <= 0 || Math.abs(current - aspect) < 0.01) {
    return image;
  }
  const width = current > aspect ? Math.round(image.height * aspect) : image.width;
  const height = current > aspect ? image.height : Math.round(image.width / aspect);
  const left = Math.floor((image.width - width) / 2);
  const top = Math.floor((image.height - height) / 2);
  const cropped = sharp(image.data).extract({ left, top, width, height });
  const { data, info } =
    image.type === 'png'
      ? await cropped.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await cropped.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { data, type: image.type, width: info.width, height: info.height };
}

const toHex = (value: number): string => Math.round(value).toString(16).padStart(2, '0');

/**
 * The brand color of a logo: the most common clearly colored pixel, ignoring transparency, white,
 * black and grays. Null when the logo has no such color (a black or white logo).
 */
export async function brandColor(image: PreparedImage): Promise<string | null> {
  const { data, info } = await sharp(image.data)
    .resize({ width: 64, height: 64, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 160) {
      continue;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    if (saturation < 0.3 || lightness > 0.9 || lightness < 0.12) {
      continue;
    }
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (best == null || bucket.count > best.count) {
      best = bucket;
    }
  }
  /* A few stray colored pixels on an otherwise plain logo are not its brand. */
  const visible = data.length / info.channels;
  if (best == null || best.count < visible * 0.02) {
    return null;
  }
  return `${toHex(best.r / best.count)}${toHex(best.g / best.count)}${toHex(best.b / best.count)}`.toUpperCase();
}
