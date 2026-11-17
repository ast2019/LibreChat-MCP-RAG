// Shared low-level helpers for group g. Only maths, a canvas wrapper and shape rasterising live here:
// every style builds its own look on top.
import React, { useLayoutEffect, useRef } from "react";
import { KNOB, P } from "../../story";
// Fast deterministic integer hash, returns 0..1
export const hash = (a: number, b = 0, c = 0) => {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 73856093) ^ Math.imul((b | 0) + 7, 19349663) ^ Math.imul((c | 0) + 3, 83492791);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  return ((x ^ (x >>> 11)) >>> 0) / 4294967296;
};

export type Q = { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };
export const parseStream = (d: string): Q => {
  const n = (d.match(/-?\d+(\.\d+)?/g) as string[]).map(Number);
  return { x1: n[0], y1: n[1], cx: n[2], cy: n[3], x2: n[4], y2: n[5] };
};
export const qAt = (q: Q, t: number) => {
  const u = 1 - t;
  return {
    x: u * u * q.x1 + 2 * u * t * q.cx + t * t * q.x2,
    y: u * u * q.y1 + 2 * u * t * q.cy + t * t * q.y2,
  };
};

export const pathPts = (d: string) => {
  const n = (d.match(/-?\d+(\.\d+)?/g) as string[]).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  return out;
};

export const hexRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// A canvas redrawn on every render (so on every Remotion frame), synchronously before the screenshot.
export const Cv: React.FC<{
  w: number;
  h: number;
  draw: (c: CanvasRenderingContext2D, el: HTMLCanvasElement) => void;
  pixel?: boolean;
  dispW?: number;
  dispH?: number;
  style?: React.CSSProperties;
}> = ({ w, h, draw, pixel, dispW = 1080, dispH = 1350, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = ref.current as HTMLCanvasElement;
    const c = el.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
    c.clearRect(0, 0, w, h);
    draw(c, el);
  });
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: dispW,
        height: dispH,
        imageRendering: pixel ? "pixelated" : "auto",
        ...style,
      }}
    />
  );
};

export const offscreen = (w: number, h: number) => {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return { el, c: el.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D };
};

export const maskOf = (w: number, h: number, paint: (c: CanvasRenderingContext2D) => void, thr = 110) => {
  const { c } = offscreen(w, h);
  c.fillStyle = "#fff";
  c.strokeStyle = "#fff";
  paint(c);
  const d = c.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > thr ? 1 : 0;
  return m;
};

export type PartMask = { k: "handle" | "spout" | "body" | "band" | "lid" | "knob"; mask: Uint8Array };

// The kettle as separate boolean part masks, at low resolution, posed at a tilt. Origin sits at the centre of an n x n grid.
export const kettleMasks = (tiltDeg: number, scale: number, n: number): PartMask[] => {
  const pose = (c: CanvasRenderingContext2D) => {
    c.translate(n / 2, n / 2);
    c.rotate((tiltDeg * Math.PI) / 180);
    c.scale(scale, scale);
    c.lineCap = "round";
    c.lineJoin = "round";
  };
  const make = (k: PartMask["k"], paint: (c: CanvasRenderingContext2D) => void): PartMask => ({
    k,
    mask: maskOf(n, n, (c) => {
      pose(c);
      paint(c);
    }),
  });
  const parts = [
    make("handle", (c) => {
      c.lineWidth = 26;
      c.stroke(new Path2D(P.kettleHandle));
    }),
    make("spout", (c) => c.fill(new Path2D(P.kettleSpout))),
    make("body", (c) => c.fill(new Path2D(P.kettleBody))),
    make("band", (c) => {
      c.lineWidth = 14;
      c.stroke(new Path2D(P.kettleBand));
    }),
    make("lid", (c) => {
      c.fill(new Path2D(P.kettleLid));
      c.fillRect(-92, -92, 184, 16);
    }),
    make("knob", (c) => {
      c.beginPath();
      c.arc(KNOB.x, KNOB.y, KNOB.r + 3, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-6, KNOB.y, 12, 30);
    }),
  ];
  const body = parts[2].mask;
  const band = parts[3].mask;
  for (let i = 0; i < band.length; i++) band[i] = band[i] && body[i] ? 1 : 0;
  return parts;
};
