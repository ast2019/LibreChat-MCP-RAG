// Small shared maths for group b. Drawing stays inside each style.
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const noise = (t: number, seed = 0) => {
  const i = Math.floor(t);
  const u = t - i;
  const k = u * u * (3 - 2 * u);
  return hash(i + seed * 57) * (1 - k) + hash(i + 1 + seed * 57) * k;
};

export type Q = { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };

export const parseStream = (d: string): Q => {
  const m = (d.match(/-?\d+(\.\d+)?/g) as string[]).map(Number);
  return { x1: m[0], y1: m[1], cx: m[2], cy: m[3], x2: m[4], y2: m[5] };
};

export const quadAt = (q: Q, t: number) => ({
  x: (1 - t) * (1 - t) * q.x1 + 2 * (1 - t) * t * q.cx + t * t * q.x2,
  y: (1 - t) * (1 - t) * q.y1 + 2 * (1 - t) * t * q.cy + t * t * q.y2,
});
// Two-bone limb: returns the elbow or knee between a and b.
export const ik = (ax: number, ay: number, bx: number, by: number, l1: number, l2: number, side: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(len, l1 + l2 - 0.5);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / len;
  const uy = dy / len;
  return { x: ax + ux * a - uy * h * side, y: ay + uy * a + ux * h * side };
};

// Teardrop pointing along `deg`, as a closed path string.
export const petal = (cx: number, cy: number, deg: number, len: number, wid: number) => {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const tx = cx + ux * len;
  const ty = cy + uy * len;
  const mx = cx + ux * len * 0.42;
  const my = cy + uy * len * 0.42;
  const nx = -uy * wid;
  const ny = ux * wid;
  return `M${cx.toFixed(1)},${cy.toFixed(1)} Q${(mx + nx).toFixed(1)},${(my + ny).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} Q${(mx - nx).toFixed(1)},${(my - ny).toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)} Z `;
};

export const diamond = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx},${cy} L${cx},${cy - ry} L${cx + rx},${cy} L${cx},${cy + ry} Z `;

export const circlePath = (cx: number, cy: number, r: number) =>
  `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z `;
