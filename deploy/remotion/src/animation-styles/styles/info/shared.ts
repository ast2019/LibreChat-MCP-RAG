import { interpolate } from "remotion";

export const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// The pour segment between the spout and any landing point, on the story's own beats.
export const pourSeg = (f: number, tip: { x: number; y: number }, tx: number, ty: number) => {
  const head = interpolate(f, [42, 47], [0, 1], cl);
  const tail = interpolate(f, [96, 101], [0, 1], cl);
  return {
    on: f >= 42 && tail < 1,
    x1: tip.x + (tx - tip.x) * tail,
    y1: tip.y + (ty - tip.y) * tail,
    x2: tip.x + (tx - tip.x) * head,
    y2: tip.y + (ty - tip.y) * head,
    head,
    tail,
  };
};

export const pourD = (p: { x1: number; y1: number; x2: number; y2: number }) =>
  `M${p.x1.toFixed(1)},${p.y1.toFixed(1)} Q${(p.x1 - 12).toFixed(1)},${((p.y1 + p.y2) / 2).toFixed(1)} ${p.x2.toFixed(1)},${p.y2.toFixed(1)}`;

export const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
