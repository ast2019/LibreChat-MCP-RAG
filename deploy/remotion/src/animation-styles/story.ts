// The one story every style redraws: a kettle pours chai into a kulhad, steam rises. 5 s, no text.
// Styles change how it looks, never what happens or when, so the demos can be compared side by side.
import { Easing, interpolate } from "remotion";

export const W = 1080;
export const H = 1350;
export const FPS = 30;
export const DUR = 150;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const io = Easing.inOut(Easing.cubic);

export const KETTLE_REST = { x: 796, y: 324 };
export const POUR_TILT = -38;
const TIP = { x: -251, y: -62 };

export const P = {
  kulhadBody: "M370,800 L425,1040 Q540,1076 655,1040 L710,800 Q540,868 370,800 Z",
  kulhadOutline: "M370,800 L425,1040 Q540,1076 655,1040 L710,800",
  rim: "M370,800 A170,42 0 1,0 710,800 A170,42 0 1,0 370,800 Z",
  kettleBody: "M-130,-70 C-172,40 -152,132 -90,140 L90,140 C152,132 172,40 130,-70 Q0,-102 -130,-70 Z",
  kettleLid: "M-92,-86 Q0,-152 92,-86 Q0,-108 -92,-86 Z",
  kettleSpout: "M-142,32 C-200,12 -226,-30 -263,-50 L-240,-77 C-206,-56 -170,-42 -130,-42 Z",
  kettleHandle: "M140,-42 C256,-74 256,94 140,92",
  kettleBand: "M-160,44 Q0,76 160,44",
};
export const KNOB = { x: 0, y: -129, r: 17 };

export const rot = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};

export const surfaceAt = (level: number) => ({
  cx: 540,
  cy: 838 - 34 * level,
  rx: 130 + 30 * level,
  ry: 30 + 8 * level,
});

const STRANDS = [
  { x: 470, start: 104 },
  { x: 540, start: 112 },
  { x: 610, start: 120 },
];
const STEAM_BASE = 770;
const STEAM_TOP = 400;

// One steam strand as a path. `p` is how much of it has risen, `t0` lets a style drift it over time.
export const steamPath = (i: number, p: number, t0: number) => {
  const { x } = STRANDS[i];
  const n = 36;
  let d = "";
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * p;
    const px = x + Math.sin(t * Math.PI * 2.6 + t0 + i * 1.7) * (16 + 34 * t);
    const py = STEAM_BASE - (STEAM_BASE - STEAM_TOP) * t;
    d += `${k === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)} `;
  }
  return d;
};

export const storyAt = (f: number) => {
  const enter = interpolate(f, [0, 24], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const exit = interpolate(f, [104, 126], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const tilt = interpolate(f, [24, 42, 96, 110], [0, POUR_TILT, POUR_TILT, 0], { ...clamp, easing: io });
  const kx = KETTLE_REST.x + 560 * enter + 560 * exit;
  const ky = KETTLE_REST.y;
  const r = rot(TIP.x, TIP.y, tilt);
  const tip = { x: kx + r.x, y: ky + r.y };
  const level = interpolate(f, [44, 100], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const surface = surfaceAt(level);
  const head = interpolate(f, [42, 47], [0, 1], clamp);
  const tail = interpolate(f, [96, 101], [0, 1], clamp);
  const streaming = f >= 42 && tail < 1;
  const y1 = tip.y + (surface.cy - tip.y) * tail;
  const y2 = tip.y + (surface.cy - tip.y) * head;
  const x2 = tip.x + (548 - tip.x) * head;
  const x1 = tip.x + (548 - tip.x) * tail;
  const stream = `M${x1.toFixed(1)},${y1.toFixed(1)} Q${(x1 - 10).toFixed(1)},${((y1 + y2) / 2).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  const steam = STRANDS.map((s) =>
    interpolate(f, [s.start, s.start + 30], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) }),
  );
  return { kx, ky, tilt, tip, level, surface, streaming, stream, steam };
};
