import React, { useLayoutEffect, useRef } from "react";
import { P } from "../../story";

export type Pt = { x: number; y: number };
export type Story = ReturnType<typeof import("../../story").storyAt>;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Seeded generator so every frame is reproducible.
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Reads the points out of a steamPath string.
export const pts = (d: string): Pt[] => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));

// A tapered ribbon polygon along a polyline.
export const ribbon = (p: Pt[], w0: number, w1: number) => {
  const a: string[] = [];
  const b: string[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const u = p[Math.max(i - 1, 0)];
    const v = p[Math.min(i + 1, n - 1)];
    const dx = v.x - u.x;
    const dy = v.y - u.y;
    const len = Math.hypot(dx, dy) || 1;
    const w = lerp(w0, w1, n > 1 ? i / (n - 1) : 0) / 2;
    a.push(`${(p[i].x - (dy / len) * w).toFixed(1)},${(p[i].y + (dx / len) * w).toFixed(1)}`);
    b.push(`${(p[i].x + (dy / len) * w).toFixed(1)},${(p[i].y - (dx / len) * w).toFixed(1)}`);
  }
  return `M${[...a, ...b.reverse()].join(" L")} Z`;
};

// A gouge mark: a lens-shaped cut between two points.
export const wedge = (x0: number, y0: number, x1: number, y1: number, w: number) => {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} Q${(mx + nx).toFixed(1)},${(my + ny).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} Q${(mx - nx).toFixed(1)},${(my - ny).toFixed(1)} ${x0.toFixed(1)},${y0.toFixed(1)} Z `;
};

// An inward spiral, used for curled steam heads.
export const spiral = (cx: number, cy: number, r: number, turns: number, start: number, dir = 1) => {
  let d = "";
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + dir * t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.9);
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return d;
};

// Canvas repainted once per frame, synchronously, so the capture always sees the right picture.
export const Raster: React.FC<{
  frame: number;
  width: number;
  height: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
  style?: React.CSSProperties;
}> = ({ frame, width, height, paint, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    paint(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ position: "absolute", left: 0, top: 0, ...style }} />;
};

const LAYERS = new Map<string, HTMLCanvasElement>();
// A cleared offscreen canvas, reused between frames.
export const layer = (key: string, w: number, h: number) => {
  let c = LAYERS.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    LAYERS.set(key, c);
  }
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  return ctx;
};

let PATHS: Record<keyof typeof P, Path2D> | null = null;
export const paths = () => {
  if (!PATHS) {
    PATHS = Object.fromEntries(Object.entries(P).map(([k, d]) => [k, new Path2D(d)])) as Record<keyof typeof P, Path2D>;
  }
  return PATHS;
};

export const inKettle = (c: CanvasRenderingContext2D, s: Story, fn: () => void) => {
  c.save();
  c.translate(s.kx, s.ky);
  c.rotate((s.tilt * Math.PI) / 180);
  fn();
  c.restore();
};

export const gray = (tone: number) => {
  const v = Math.round(255 * (1 - clamp01(tone)));
  return `rgb(${v},${v},${v})`;
};
