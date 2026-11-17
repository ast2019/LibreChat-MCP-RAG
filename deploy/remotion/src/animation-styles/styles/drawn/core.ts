// Group A helpers: geometry only. Each style keeps its own drawing logic in a-*.tsx.
import { getLength, getPointAtLength } from "@remotion/paths";
import { interpolate } from "remotion";
import { P, rot } from "../../story";

export type Pt = { x: number; y: number };
export const clampX = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const cache = new Map<string, Pt[]>();
export const sample = (d: string, step = 6): Pt[] => {
  const key = `${step}|${d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const L = getLength(d);
  const n = Math.max(2, Math.ceil(L / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const p = getPointAtLength(d, Math.min(L - 0.001, (L * i) / n)) as Pt | null;
    if (!p) throw new Error(`no point at ${i}/${n} on ${d}`);
    out.push({ x: p.x, y: p.y });
  }
  cache.set(key, out);
  return out;
};

export const rng = (seed: number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const h1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export const noise1 = (x: number, seed: number) => {
  const i = Math.floor(x);
  const t = x - i;
  const u = t * t * (3 - 2 * t);
  return (h1(i + seed * 17.3) * (1 - u) + h1(i + 1 + seed * 17.3) * u) * 2 - 1;
};

export const wobble = (pts: Pt[], seed: number, amp: number, wave = 9): Pt[] =>
  pts.map((p, i) => ({ x: p.x + noise1(i / wave, seed) * amp, y: p.y + noise1(i / wave, seed + 41) * amp }));

export const lineD = (pts: Pt[], close = false) => {
  let d = "";
  for (let i = 0; i < pts.length; i++) d += `${i ? "L" : "M"}${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`;
  return close ? `${d}Z` : d;
};

export const place = (pts: Pt[], x: number, y: number, deg: number): Pt[] =>
  pts.map((p) => {
    const r = rot(p.x, p.y, deg);
    return { x: r.x + x, y: r.y + y };
  });

export const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 56): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
};

export const clampToRim = (pts: Pt[], m = 0.97): Pt[] =>
  pts.map((p) => {
    const dx = (p.x - 540) / 170;
    const dy = (p.y - 800) / 42;
    const r = Math.hypot(dx, dy);
    if (r <= m) return p;
    return { x: 540 + (dx / r) * m * 170, y: 800 + (dy / r) * m * 42 };
  });

export type Seg = [Pt, Pt];
// Scanline fill of a polygon at any angle; returns one segment per interior run.
export const scan = (poly: Pt[], gap: number, angle = 0): Seg[] => {
  const q = poly.map((p) => rot(p.x, p.y, -angle));
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of q) {
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  }
  const out: Seg[] = [];
  for (let y = lo + gap * 0.5; y < hi; y += gap) {
    const xs: number[] = [];
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const b = q[(i + 1) % q.length];
      if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const l = rot(xs[i], y, angle);
      const r = rot(xs[i + 1], y, angle);
      out.push([l, r]);
    }
  }
  return out;
};

export const segD = (segs: Seg[]) => {
  let d = "";
  for (const [a, b] of segs) d += `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  return d;
};

// One continuous back-and-forth line through scan segments.
export const zigPts = (segs: Seg[]): Pt[] => {
  const out: Pt[] = [];
  segs.forEach(([a, b], i) => {
    if (i % 2) out.push(b, a);
    else out.push(a, b);
  });
  return out;
};

export const pathPts = (d: string): Pt[] => {
  const out: Pt[] = [];
  const re = /[ML]\s*(-?[\d.]+),(-?[\d.]+)/g;
  let m = re.exec(d);
  while (m) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
    m = re.exec(d);
  }
  return out;
};

// The pour, with the same head and tail timing as storyAt, ending anywhere a style needs it.
export const pourPts = (f: number, tip: Pt, end: Pt, n = 26): Pt[] => {
  const head = interpolate(f, [42, 47], [0, 1], clampX);
  const tail = interpolate(f, [96, 101], [0, 1], clampX);
  const x1 = tip.x + (end.x - tip.x) * tail;
  const y1 = tip.y + (end.y - tip.y) * tail;
  const x2 = tip.x + (end.x - tip.x) * head;
  const y2 = tip.y + (end.y - tip.y) * head;
  const cx = x1 - 10;
  const cy = (y1 + y2) / 2;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * x1 + 2 * u * t * cx + t * t * x2, y: u * u * y1 + 2 * u * t * cy + t * t * y2 });
  }
  return out;
};

// Tapered brush mark: a closed polygon around a centre line.
export const brush = (pts: Pt[], width: (t: number, i: number) => number): string => {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const w = width(i / (n - 1), i) / 2;
    L.push({ x: pts[i].x - (dy / m) * w, y: pts[i].y + (dx / m) * w });
    R.push({ x: pts[i].x + (dy / m) * w, y: pts[i].y - (dx / m) * w });
  }
  return lineD([...L, ...R.reverse()], true);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const toRgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${hex(lerp(x[0], y[0], t))}${hex(lerp(x[1], y[1], t))}${hex(lerp(x[2], y[2], t))}`;
};

export const POLY = {
  body: sample(P.kulhadBody, 7),
  rim: sample(P.rim, 7),
  kBody: sample(P.kettleBody, 7),
  lid: sample(P.kettleLid, 6),
  spout: sample(P.kettleSpout, 6),
  handle: sample(P.kettleHandle, 6),
  band: sample(P.kettleBand, 6),
  kulhadLine: sample(P.kulhadOutline, 6),
};
