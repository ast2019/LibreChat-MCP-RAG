// 64 Pixel art / RPG: a 108x135 framebuffer with a fixed 24-colour palette, upscaled 10x. Inn interior, dialogue box.
import React from "react";
import { useCurrentFrame } from "remotion";
import { P, steamPath, storyAt } from "../../story";
import { Cv, hash, hexRgb, kettleMasks, maskOf, parseStream, pathPts, qAt } from "./core";

const GW = 108;
const GH = 135;
const HEX = [
  "#15101f", "#2c2140", "#4b3763", "#6e5a8a", "#9a86ad",
  "#3e2421", "#6b3b2a", "#a05f35", "#d2924f", "#f5c96a",
  "#fff1c9", "#7d2f1e", "#b3532c", "#df8545", "#5a2d10",
  "#a8601f", "#e0a042", "#1f4a72", "#3f85ad", "#8fd6df",
  "#eafcff", "#d1382f", "#ffe27a", "#101b45",
];
const [K, D, V, S, L, W1, W2, W3, W4, Y, CR, C1, C2, C3, T1, T2, T3, B1, B2, B3, B4, R, YL, N] = HEX.map((_, i) => i);
const RGB = HEX.map(hexRgb);

type FB = Uint8Array;
const put = (fb: FB, x: number, y: number, c: number) => {
  if (x >= 0 && y >= 0 && x < GW && y < GH) fb[y * GW + x] = c;
};
const rect = (fb: FB, x: number, y: number, w: number, h: number, c: number) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(fb, i, j, c);
};

const FONT: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111", "!": "010010010000010", ".": "000000000000010", " ": "000000000000000",
};
const text = (fb: FB, s: string, x: number, y: number, c: number) => {
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i]] ?? FONT[" "];
    for (let k = 0; k < 15; k++) if (g[k] === "1") put(fb, x + i * 4 + (k % 3), y + Math.floor(k / 3), c);
  }
};

// Inn wall, shelf, window, floor and counter, painted once.
let bg: FB | null = null;
const POTIONS = [R, B2, YL, 22 - 3];
const buildBg = (): FB => {
  const fb = new Uint8Array(GW * GH);
  rect(fb, 0, 0, GW, 70, V);
  for (let row = 0; row * 8 < 70; row++) {
    const off = row % 2 ? 7 : 0;
    for (let b = -1; b * 14 < GW; b++) {
      const x = b * 14 + off;
      const n = hash(b, row);
      const base = n > 0.82 ? D : n > 0.3 ? S : V + 1;
      rect(fb, x + 1, row * 8 + 1, 13, 6, base === S ? D + 1 : D);
      rect(fb, x + 1, row * 8 + 1, 13, 1, base === D ? V : S);
      if (n > 0.55) rect(fb, x + 3, row * 8 + 3, 2, 1, V);
      if (n > 0.9) rect(fb, x + 8, row * 8 + 5, 3, 1, K);
    }
  }
  // Window
  rect(fb, 7, 8, 24, 26, W1);
  rect(fb, 9, 10, 20, 22, N);
  rect(fb, 18, 10, 2, 22, W2);
  rect(fb, 9, 20, 20, 2, W2);
  rect(fb, 24, 12, 3, 3, CR);
  rect(fb, 25, 11, 1, 5, CR);
  rect(fb, 23, 13, 5, 1, CR);
  for (let s = 0; s < 7; s++) put(fb, 10 + Math.floor(hash(s, 3) * 8), 11 + Math.floor(hash(s, 9) * 8), L);
  for (let s = 0; s < 6; s++) put(fb, 21 + Math.floor(hash(s, 5) * 7), 23 + Math.floor(hash(s, 2) * 8), L);
  // Shelf with bottles
  rect(fb, 5, 45, 30, 2, W3);
  rect(fb, 5, 47, 30, 1, W1);
  POTIONS.forEach((c, i) => {
    const x = 8 + i * 7;
    rect(fb, x, 39, 5, 6, c);
    rect(fb, x + 1, 37, 3, 2, L);
    rect(fb, x + 1, 36, 3, 1, W3);
    rect(fb, x, 39, 1, 6, K);
    rect(fb, x + 4, 39, 1, 6, K);
    put(fb, x + 1, 40, CR);
  });
  // Floor planks
  rect(fb, 0, 70, GW, 19, W2);
  for (let j = 0; j < 4; j++) {
    rect(fb, 0, 70 + j * 5, GW, 1, W1);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(hash(i, j) * 12) + i * 16;
      rect(fb, x, 70 + j * 5, 1, 5, W1);
      rect(fb, x + 3, 72 + j * 5, 4, 1, W3);
    }
  }
  rect(fb, 0, 69, GW, 1, K);
  // Counter
  rect(fb, 0, 89, GW, 24, W3);
  rect(fb, 0, 89, GW, 1, W4);
  for (let j = 0; j < 3; j++) rect(fb, 0, 96 + j * 7, GW, 1, W2);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash(i, 44) * GW);
    const y = 91 + Math.floor(hash(i, 45) * 20);
    rect(fb, x, y, 3 + Math.floor(hash(i, 46) * 5), 1, hash(i, 47) > 0.5 ? W4 : W2);
  }
  rect(fb, 0, 113, GW, 5, W1);
  rect(fb, 0, 113, GW, 1, K);
  return fb;
};

// Innkeeper, an original chibi sprite standing behind the counter.
const KEEPER = [
  "...oooooo...",
  "..obbbbbbo..",
  ".obbbbbbbbo.",
  ".obssssssbo.",
  ".osesssesso.",
  ".osesssesso.",
  ".ossssssso..",
  "..osrrsso...",
  "...oooooo...",
  "..ocwwwwco..",
  ".occwwwwcco.",
  ".oscwwwwcso.",
  ".oocwwwwcoo.",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "..owwwwwwo..",
];
const KEEPCOL: Record<string, number> = { o: K, b: W1, s: C3, e: K, r: C2, c: B2, w: CR };

type Spr = Int16Array;
const SN = 64;
const toneOf = (t: number[], u: number, v: number, x: number, y: number) => {
  const q = u * 0.8 + v * 0.2;
  const d = (x + y) % 2;
  if (q < 0.2) return t[3];
  if (q < 0.24) return d ? t[3] : t[2];
  if (q < 0.5) return t[2];
  if (q < 0.54) return d ? t[2] : t[1];
  if (q < 0.76) return t[1];
  if (q < 0.8) return d ? t[1] : t[0];
  return t[0];
};
const paintMask = (spr: Spr, mask: Uint8Array, n: number, tones: number[]) => {
  let x0 = n, x1 = 0, y0 = n, y1 = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (mask[y * n + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const out = new Int16Array(n * n).fill(-1);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      const seam = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => {
        const i = (y + b) * n + x + a;
        return !mask[i] && spr[i] !== -1 && spr[i] !== K;
      });
      out[y * n + x] = seam ? K : toneOf(tones, (x - x0) / Math.max(1, x1 - x0), (y - y0) / Math.max(1, y1 - y0), x, y);
    }
  for (let i = 0; i < n * n; i++) if (out[i] !== -1) spr[i] = out[i];
};
const outline = (spr: Spr, n: number) => {
  const copy = spr.slice();
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      if (copy[y * n + x] !== -1) continue;
      if (copy[y * n + x + 1] !== -1 || copy[y * n + x - 1] !== -1 || copy[(y + 1) * n + x] !== -1 || copy[(y - 1) * n + x] !== -1)
        spr[y * n + x] = K;
    }
};

const cache = new Map<number, Spr>();
const kettleSprite = (tilt: number) => {
  const hit = cache.get(tilt);
  if (hit) return hit;
  const spr: Spr = new Int16Array(SN * SN).fill(-1);
  const T: Record<string, number[]> = {
    handle: [W1, W2, W3, W4],
    spout: [B1, B2, B3, B4],
    body: [B1, B2, B3, B4],
    band: [W3, W4, Y, YL],
    lid: [B1, B2, B3, B4],
    knob: [W3, W4, Y, CR],
  };
  for (const p of kettleMasks(tilt, 0.1, SN)) paintMask(spr, p.mask, SN, T[p.k]);
  outline(spr, SN);
  cache.set(tilt, spr);
  return spr;
};

let cupSpr: Spr | null = null;
const CUPN = 64;
const CUPO = { x: 22, y: 60 };
const cupSprite = () => {
  if (cupSpr) return cupSpr;
  const spr: Spr = new Int16Array(CUPN * CUPN).fill(-1);
  const pose = (c: CanvasRenderingContext2D) => {
    c.scale(0.1, 0.1);
    c.translate(-CUPO.x * 10, -CUPO.y * 10);
  };
  const body = maskOf(CUPN, CUPN, (c) => {
    pose(c);
    c.fill(new Path2D(P.kulhadBody));
  });
  const rim = maskOf(CUPN, CUPN, (c) => {
    pose(c);
    c.fill(new Path2D(P.rim));
  });
  paintMask(spr, body, CUPN, [C1, C2, C3, 8]);
  // Clay flecks and a pressed-in band
  for (let y = 0; y < CUPN; y++)
    for (let x = 0; x < CUPN; x++) {
      const i = y * CUPN + x;
      if (!body[i]) continue;
      if (hash(x, y, 8) > 0.93) spr[i] = C1;
      if (y === 39 || y === 40) spr[i] = (x + y) % 3 === 0 ? C1 : spr[i];
    }
  paintMask(spr, rim, CUPN, [C2, C3, C3, W4]);
  outline(spr, CUPN);
  cupSpr = spr;
  return spr;
};

const stamp = (fb: FB, spr: Spr, n: number, ox: number, oy: number) => {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = spr[y * n + x];
      if (c !== -1) put(fb, ox + x, oy + y, c);
    }
};

const ellipse = (fb: FB, cx: number, cy: number, rx: number, ry: number, c: (x: number, y: number) => number, clip?: (x: number, y: number) => boolean) => {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const a = (x + 0.5 - cx) / rx;
      const b = (y + 0.5 - cy) / ry;
      if (a * a + b * b <= 1 && (!clip || clip(x, y))) put(fb, x, y, c(x, y));
    }
};

const LINES: [number, string][] = [
  [0, "THE KETTLE ARRIVES!"],
  [42, "IT POURS HOT CHAI..."],
  [104, "THE KULHAD IS FULL!"],
];

export const PixelRPG: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const draw = (c: CanvasRenderingContext2D) => {
    if (!bg) bg = buildBg();
    const fb = bg.slice();

    // Torch, three-frame flame
    const fr = Math.floor(f / 4) % 3;
    rect(fb, 94, 34, 3, 12, W1);
    rect(fb, 92, 32, 7, 3, W3);
    rect(fb, 93, 25 + fr, 5, 7 - fr, R);
    rect(fb, 94, 26 + fr, 3, 6 - fr, 9);
    rect(fb, 95, 28 + fr, 1, 3, CR);
    rect(fb, 93 + (fr === 1 ? 1 : 0), 23 + fr, 2, 2, R);

    // Innkeeper bobs on a two-beat idle and hops when the cup is full
    const bob = Math.floor(f / 15) % 2;
    const hop = f > 106 && Math.floor(f / 6) % 2 === 0 ? -2 : 0;
    const blink = Math.floor(f / 3) % 22 === 0;
    const kx = 7;
    const ky = 72 + bob + hop;
    KEEPER.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === ".") continue;
        if (ky + j >= 89) continue;
        put(fb, kx + i, ky + j, ch === "e" && blink ? C2 : KEEPCOL[ch]);
      }
    });

    // Cup
    const cup = cupSprite();
    stamp(fb, cup, CUPN, CUPO.x, CUPO.y);
    const inside = (x: number, y: number) => {
      const a = (x + 0.5 - 54) / 15.6;
      const b = (y + 0.5 - 80) / 3.4;
      return a * a + b * b <= 1;
    };
    ellipse(fb, 54, 80, 15.6, 3.4, (x, y) => ((x + y) % 2 ? C1 : T1));
    if (s.level > 0) {
      const su = s.surface;
      ellipse(
        fb,
        su.cx / 10,
        su.cy / 10,
        su.rx / 10,
        su.ry / 10,
        (x, y) => {
          const a = (x + 0.5 - su.cx / 10) / (su.rx / 10);
          const b = (y + 0.5 - su.cy / 10) / (su.ry / 10);
          if (a < -0.45 && b < 0.2) return T3;
          if (a * a + b * b > 0.7) return T1;
          return T2;
        },
        inside,
      );
    }

    // Kettle on four tilt drawings only, like a hand-keyed sprite sheet
    const tiltQ = Math.round(s.tilt / -9.5) * -9.5;
    const spr = kettleSprite(tiltQ === 0 ? 0 : tiltQ);
    if (s.streaming) {
      const q = parseStream(s.stream);
      const n = Math.ceil(Math.abs(q.y2 - q.y1) / 8);
      for (let i = 0; i <= n; i++) {
        const p = qAt(q, i / Math.max(1, n));
        const x = Math.round(p.x / 10);
        const y = Math.round(p.y / 10);
        put(fb, x - 2, y, T1);
        put(fb, x - 1, y, T2);
        put(fb, x, y, (y + Math.floor(f / 2)) % 4 === 0 ? CR : T3);
        put(fb, x + 1, y, T2);
        put(fb, x + 2, y, T1);
      }
      for (let k = 0; k < 4; k++) {
        const a = hash(k, sf);
        put(fb, Math.round(q.x2 / 10 + (a - 0.5) * 18), Math.round(s.surface.cy / 10 - 1 - hash(k, sf, 2) * 3), hash(k, sf, 3) > 0.5 ? T3 : CR);
      }
    }
    stamp(fb, spr, SN, Math.round(s.kx / 10) - SN / 2, Math.round(s.ky / 10) - SN / 2);

    // Steam, dropping out in a stepped checker as it climbs
    [0, 1, 2].forEach((i) => {
      if (s.steam[i] <= 0) return;
      const pts = pathPts(steamPath(i, s.steam[i], sf * 0.05));
      pts.forEach((p, k) => {
        if ((k + Math.floor(f / 4)) % 5 === 0) return;
        const x = Math.round(p.x / 10);
        const y = Math.round(p.y / 10);
        if (k > pts.length * 0.72 && (x + y) % 2) return;
        put(fb, x, y, CR);
        put(fb, x + 1, y, k > pts.length * 0.4 ? L : CR);
      });
    });

    // Sparkles once the cup is full
    if (f > 104) {
      for (let k = 0; k < 6; k++) {
        const phase = Math.floor(f / 4 + k * 2) % 6;
        if (phase > 2) continue;
        const x = 34 + Math.floor(hash(k, 77) * 42);
        const y = 74 + Math.floor(hash(k, 78) * 28);
        put(fb, x, y, CR);
        if (phase === 1) {
          put(fb, x - 1, y, YL);
          put(fb, x + 1, y, YL);
          put(fb, x, y - 1, YL);
          put(fb, x, y + 1, YL);
        }
      }
    }

    // Dialogue box
    rect(fb, 2, 118, 104, 16, K);
    rect(fb, 3, 119, 102, 14, CR);
    rect(fb, 4, 120, 100, 12, N);
    rect(fb, 5, 121, 98, 1, B1);
    let line = LINES[0];
    for (const l of LINES) if (f >= l[0]) line = l;
    const chars = Math.floor((f - line[0]) / 1.2) + 1;
    text(fb, line[1].slice(0, chars), 9, 124, CR);
    if (chars > line[1].length && Math.floor(f / 8) % 2) {
      rect(fb, 97, 127, 5, 1, YL);
      rect(fb, 98, 128, 3, 1, YL);
      put(fb, 99, 129, YL);
    }

    const img = c.createImageData(GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      const col = RGB[fb[i]];
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#15101f" }}>
      <Cv w={GW} h={GH} draw={draw} pixel />
    </div>
  );
};
