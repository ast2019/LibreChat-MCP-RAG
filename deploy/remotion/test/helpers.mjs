// Test helpers: a tiny PNG encoder/decoder (zlib only) and frame statistics for blank checks.
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** RGB PNG from a pixel function (x, y) => [r, g, b]. */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A landscape-like test photo: sky gradient, sun, hills (so Ken Burns has detail). */
export function samplePhoto(width = 960, height = 640) {
  return encodePng(width, height, (x, y) => {
    const sky = y / height;
    const sun = Math.hypot(x - width * 0.7, y - height * 0.3) < height * 0.12;
    const hill = y > height * (0.62 + 0.08 * Math.sin(x / 90));
    if (sun) return [255, 214, 102];
    if (hill) return [34 + ((x * 7) % 30), 120 + ((y * 3) % 40), 70];
    return [Math.round(60 + 120 * sky), Math.round(120 + 80 * sky), 220];
  });
}

/** Luminance mean and standard deviation of an 8-bit RGB/RGBA PNG (no interlace). */
export function pngStats(buffer) {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat = [];
  while (at < buffer.length) {
    const len = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    for (let px = 0; px < width; px += 1) {
      const o = px * channels;
      const lum = 0.2126 * line[o] + 0.7152 * line[o + 1] + 0.0722 * line[o + 2];
      sum += lum;
      sumSq += lum * lum;
    }
    line.copy(prev);
  }
  const n = width * height;
  const mean = sum / n;
  return { width, height, mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}
