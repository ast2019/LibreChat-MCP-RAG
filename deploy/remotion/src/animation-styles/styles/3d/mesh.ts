// A tiny CPU renderer for the 3D family: meshes (lathe, tube, box), a z-buffer that fills a G-buffer,
// shadow maps, smoke splats and float-buffer post. Each style writes its own shader over the G-buffer.
import { steamPath, storyAt } from "../../story";

export type V3 = [number, number, number];
export type M34 = number[];
export type Story = ReturnType<typeof storyAt>;

/* ---------- maths ---------- */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const hex = (s: string): V3 => {
  const n = parseInt(s.slice(1), 16);
  const l = (v: number) => Math.pow(v / 255, 2.2);
  return [l((n >> 16) & 255), l((n >> 8) & 255), l(n & 255)];
};
export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const I: M34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export const T = (x: number, y: number, z: number): M34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const S = (x: number, y = x, z = x): M34 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
export const RZ = (deg: number): M34 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
};
export const RY = (deg: number): M34 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
};
export const mul = (a: M34, b: M34): M34 => [
  a[0] * b[0] + a[1] * b[4] + a[2] * b[8],
  a[0] * b[1] + a[1] * b[5] + a[2] * b[9],
  a[0] * b[2] + a[1] * b[6] + a[2] * b[10],
  a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3],
  a[4] * b[0] + a[5] * b[4] + a[6] * b[8],
  a[4] * b[1] + a[5] * b[5] + a[6] * b[9],
  a[4] * b[2] + a[5] * b[6] + a[6] * b[10],
  a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7],
  a[8] * b[0] + a[9] * b[4] + a[10] * b[8],
  a[8] * b[1] + a[9] * b[5] + a[10] * b[9],
  a[8] * b[2] + a[9] * b[6] + a[10] * b[10],
  a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11],
];
/* ---------- noise (seeded, deterministic) ---------- */
export const h3 = (x: number, y: number, z: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
export const rnd = (i: number, s = 0) => h3(i, s, 77);
export const noise3 = (x: number, y: number, z: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = h3(xi, yi, zi), b = h3(xi + 1, yi, zi), c = h3(xi, yi + 1, zi), d = h3(xi + 1, yi + 1, zi);
  const e = h3(xi, yi, zi + 1), f = h3(xi + 1, yi, zi + 1), g = h3(xi, yi + 1, zi + 1), k = h3(xi + 1, yi + 1, zi + 1);
  const l0 = a + (b - a) * u, l1 = c + (d - c) * u, l2 = e + (f - e) * u, l3 = g + (k - g) * u;
  const m0 = l0 + (l1 - l0) * v, m1 = l2 + (l3 - l2) * v;
  return m0 + (m1 - m0) * w;
};
export const fbm3 = (x: number, y: number, z: number, oct: number) => {
  let a = 0.5, s = 0, t = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    t += a;
    x = x * 2.03 + 11.3;
    y = y * 2.03 + 3.7;
    z = z * 2.03 + 7.1;
    a *= 0.5;
  }
  return s / t;
};
export const ign = (x: number, y: number) => {
  const a = 52.9829189 * (((0.06711056 * x + 0.00583715 * y) % 1 + 1) % 1);
  return a - Math.floor(a);
};

/* ---------- meshes ---------- */
export class Mesh {
  col?: Float32Array; // per-face rgb
  constructor(public p: Float32Array, public n: Float32Array, public uv: Float32Array, public i: Uint32Array) {}
}
export class MB {
  p: number[] = []; n: number[] = []; uv: number[] = []; i: number[] = []; c: number[] = []; col: V3 | null = null;
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.i.push(a, b, c, a, c, d); if (this.col) this.c.push(...this.col, ...this.col); }
  tri(a: number, b: number, c: number) { this.i.push(a, b, c); if (this.col) this.c.push(...this.col); }
  build() {
    const m = new Mesh(new Float32Array(this.p), new Float32Array(this.n), new Float32Array(this.uv), new Uint32Array(this.i));
    if (this.c.length) m.col = new Float32Array(this.c);
    return m;
  }
}

type Pt = [number, number];
const expand = (profile: Pt[], crease: number) => {
  const segs: { nr: number; ny: number }[] = [];
  const pts: Pt[] = [];
  for (const p of profile) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-4) pts.push(p);
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const dr = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1];
    const l = Math.hypot(dr, dy);
    segs.push({ nr: dy / l, ny: -dr / l });
  }
  const cos = Math.cos((crease * Math.PI) / 180);
  const rings: { r: number; y: number; nr: number; ny: number; s: number }[] = [];
  let arc = 0;
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) arc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const a = segs[k - 1], b = segs[k];
    const push = (nr: number, ny: number) => {
      const l = Math.hypot(nr, ny) || 1;
      rings.push({ r: pts[k][0], y: pts[k][1], nr: nr / l, ny: ny / l, s: arc });
    };
    if (a && b && a.nr * b.nr + a.ny * b.ny > cos) push(a.nr + b.nr, a.ny + b.ny);
    else {
      if (a) push(a.nr, a.ny);
      if (b) push(b.nr, b.ny);
    }
  }
  return rings;
};

export const lathe = (profile: Pt[], segs = 48, crease = 42) => {
  const m = new MB();
  const rings = expand(profile, crease);
  const mean = rings.reduce((s, r) => s + r.r, 0) / rings.length;
  const stride = segs + 1;
  for (const r of rings)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      m.v(r.r * c, r.y, r.r * s, r.nr * c, r.ny, r.nr * s, a * mean, r.s);
    }
  for (let k = 0; k < rings.length - 1; k++) {
    if (rings[k].r === rings[k + 1].r && rings[k].y === rings[k + 1].y) continue;
    for (let j = 0; j < segs; j++) {
      const a = k * stride + j;
      m.quad(a, a + 1, a + stride + 1, a + stride);
    }
  }
  return m.build();
};

export const sphereProfile = (r: number, n = 12): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
};
export const sphere = (r: number, segs = 24, n = 12) => lathe(sphereProfile(r, n), segs, 180);
export const cyl = (r0: number, r1: number, h: number, segs = 16) =>
  lathe([[0, 0], [r0, 0], [r1, h], [0, h]], segs, 40);

export const tube = (path: V3[], radius: (t: number) => number, segs = 12, caps = true) => {
  const m = new MB();
  const n = path.length;
  let up: V3 = [0, 0, 1];
  let prevT: V3 | null = null;
  let arc = 0;
  const stride = segs + 1;
  for (let k = 0; k < n; k++) {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(n - 1, k + 1)];
    const tg = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    if (prevT) {
      const d = up[0] * tg[0] + up[1] * tg[1] + up[2] * tg[2];
      up = norm([up[0] - d * tg[0], up[1] - d * tg[1], up[2] - d * tg[2]]);
    } else {
      const d = up[0] * tg[0] + up[1] * tg[1] + up[2] * tg[2];
      up = norm([up[0] - d * tg[0], up[1] - d * tg[1], up[2] - d * tg[2]]);
    }
    prevT = tg;
    const side: V3 = [tg[1] * up[2] - tg[2] * up[1], tg[2] * up[0] - tg[0] * up[2], tg[0] * up[1] - tg[1] * up[0]];
    const r = radius(k / (n - 1));
    if (k > 0) arc += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]);
    for (let j = 0; j <= segs; j++) {
      const ang = (j / segs) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const nx = up[0] * c + side[0] * s, ny = up[1] * c + side[1] * s, nz = up[2] * c + side[2] * s;
      m.v(path[k][0] + nx * r, path[k][1] + ny * r, path[k][2] + nz * r, nx, ny, nz, ang * r, arc);
    }
  }
  for (let k = 0; k < n - 1; k++)
    for (let j = 0; j < segs; j++) {
      const a = k * stride + j;
      m.quad(a, a + 1, a + stride + 1, a + stride);
    }
  if (caps) {
    const cap = (k: number, sgn: number) => {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(n - 1, k + 1)];
      const tg = norm([(b[0] - a[0]) * sgn, (b[1] - a[1]) * sgn, (b[2] - a[2]) * sgn]);
      const c = m.v(path[k][0], path[k][1], path[k][2], tg[0], tg[1], tg[2], 0, 0);
      const first = m.p.length / 3;
      for (let j = 0; j <= segs; j++) {
        const q = (k * stride + j) * 3;
        m.v(m.p[q], m.p[q + 1], m.p[q + 2], tg[0], tg[1], tg[2], 0, 0);
      }
      for (let j = 0; j < segs; j++) m.tri(c, first + j, first + j + 1);
    };
    cap(0, -1);
    cap(n - 1, 1);
  }
  return m.build();
};

export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  const m = new MB();
  const face = (o: V3, a: V3, b: V3, n: V3, ul: number, vl: number) => {
    const v0 = m.v(o[0], o[1], o[2], n[0], n[1], n[2], 0, 0);
    const v1 = m.v(o[0] + a[0], o[1] + a[1], o[2] + a[2], n[0], n[1], n[2], ul, 0);
    const v2 = m.v(o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2], n[0], n[1], n[2], ul, vl);
    const v3 = m.v(o[0] + b[0], o[1] + b[1], o[2] + b[2], n[0], n[1], n[2], 0, vl);
    m.quad(v0, v1, v2, v3);
  };
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  face([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1], dx, dy);
  face([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1], dx, dy);
  face([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0], dz, dy);
  face([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0], dz, dy);
  face([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0], dx, dz);
  face([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0], dx, dz);
  return m.build();
};

// A gabled roof: ridge along x.
// Extrude a (z, y) profile along x. Walk the profile so the visible side is on the right of travel.
// Flat quad at height y, normal up. Optional subdivision lets vertex displacement act on it.
export const plane = (x0: number, z0: number, x1: number, z1: number, y = 0, nx = 1, nz = 1) => {
  const m = new MB();
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      m.v(x, y, z, 0, 1, 0, x, z);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      m.quad(a, a + 1, a + nx + 2, a + nx + 1);
    }
  return m.build();
};

export const paint = (m: Mesh, c: V3, jitter = 0, seed = 1) => {
  const n = m.i.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 + (rnd(i, seed) - 0.5) * jitter;
    col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
  }
  m.col = col;
  return m;
};

export const merge = (parts: [Mesh, M34?][]) => {
  let vn = 0, tn = 0;
  for (const [m] of parts) { vn += m.p.length / 3; tn += m.i.length / 3; }
  const p = new Float32Array(vn * 3), n = new Float32Array(vn * 3), uv = new Float32Array(vn * 2);
  const idx = new Uint32Array(tn * 3), col = new Float32Array(tn * 3);
  let vo = 0, to = 0;
  for (const [m, M0] of parts) {
    const M = M0 || I;
    const c = m.p.length / 3;
    for (let v = 0; v < c; v++) {
      const x = m.p[v * 3], y = m.p[v * 3 + 1], z = m.p[v * 3 + 2];
      const a = m.n[v * 3], b = m.n[v * 3 + 1], d = m.n[v * 3 + 2];
      const q = (vo + v) * 3;
      p[q] = M[0] * x + M[1] * y + M[2] * z + M[3];
      p[q + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
      p[q + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
      n[q] = M[0] * a + M[1] * b + M[2] * d;
      n[q + 1] = M[4] * a + M[5] * b + M[6] * d;
      n[q + 2] = M[8] * a + M[9] * b + M[10] * d;
      uv[(vo + v) * 2] = m.uv[v * 2];
      uv[(vo + v) * 2 + 1] = m.uv[v * 2 + 1];
    }
    const tc = m.i.length / 3;
    for (let t = 0; t < tc; t++) {
      idx[(to + t) * 3] = m.i[t * 3] + vo;
      idx[(to + t) * 3 + 1] = m.i[t * 3 + 1] + vo;
      idx[(to + t) * 3 + 2] = m.i[t * 3 + 2] + vo;
      if (m.col) {
        col[(to + t) * 3] = m.col[t * 3]; col[(to + t) * 3 + 1] = m.col[t * 3 + 1]; col[(to + t) * 3 + 2] = m.col[t * 3 + 2];
      }
    }
    vo += c; to += tc;
  }
  const out = new Mesh(p, n, uv, idx);
  out.col = col;
  return out;
};

/* ---------- the story's objects in 3D. World: x right, y up, z to camera, table at y = 0, cup at the origin ---------- */
const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1]];
};
export const RIM_Y = 258;
export const innerR = (y: number) => mix(110, 160, clamp01((y - 26) / 230));
export const outerR = (y: number) => {
  const t = clamp01((y - 14) / 236);
  return bez([118, 14], [128, 90], [150, 180], [168, 250], t)[0];
};
export const kulhadProfile = (rings = 12): Pt[] => {
  const out: Pt[] = [[0, 0], [102, 0], [112, 4], [118, 14]];
  for (let i = 1; i <= rings; i++) out.push(bez([118, 14], [128, 90], [150, 180], [168, 250], i / rings));
  out.push([172, 254], [172, 258], [167, 261], [160, 256]);
  for (let i = 1; i <= rings; i++) {
    const y = mix(256, 26, i / rings);
    out.push([innerR(y), y]);
  }
  out.push([96, 20], [0, 18]);
  return out;
};
export const kulhad = (segs = 64, rings = 12, crease = 55) => lathe(kulhadProfile(rings), segs, crease);
export const disk = (segs = 64) => lathe([[1, 0], [0, 0]], segs);

const bodyPts = (n: number) => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(bez([90, -140], [152, -132], [172, -40], [130, 70], i / n));
  return out;
};
export const bodyR = (y: number) => {
  const pts = bodyPts(40);
  for (let i = 0; i < pts.length - 1; i++)
    if (y >= pts[i][1] && y <= pts[i + 1][1]) return mix(pts[i][0], pts[i + 1][0], (y - pts[i][1]) / (pts[i + 1][1] - pts[i][1]));
  return 0;
};
export const spoutPath = (n = 22) => {
  const path: V3[] = [], rad: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const up = bez([-130, 42], [-170, 42], [-206, 56], [-240, 77], t);
    const lo = bez([-142, -32], [-200, -12], [-226, 30], [-263, 50], t);
    path.push([(up[0] + lo[0]) / 2, (up[1] + lo[1]) / 2, 0]);
    rad.push(Math.hypot(up[0] - lo[0], up[1] - lo[1]) / 2);
  }
  return { path, rad };
};
export const handlePath = (n = 26) => {
  const path: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = bez([136, 42], [256, 74], [256, -94], [136, -92], i / n);
    path.push([p[0], p[1], 0]);
  }
  return path;
};
const memo = new Map<string, unknown>();
export const once = <X>(key: string, make: () => X): X => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as X;
};
export type KettleParts = { body: Mesh; lid: Mesh; knob: Mesh; spout: Mesh; handle: Mesh; band: Mesh };
export const kettle = (segs = 72, rings = 18, tubeSegs = 18): KettleParts =>
  once(`kettle-${segs}-${rings}-${tubeSegs}`, () => {
    const prof: Pt[] = [[0, -140], ...bodyPts(rings)];
    const dome = Math.max(3, Math.round(rings / 3));
    for (let i = 1; i <= dome; i++) {
      const t = i / dome, u = 1 - t;
      prof.push([u * u * 130 + 2 * u * t * 110 + 0, u * u * 70 + 2 * u * t * 102 + t * t * 86]);
    }
    const lid: Pt[] = [[96, 84], [92, 88]];
    for (let i = 1; i <= dome; i++) {
      const t = i / dome, u = 1 - t;
      lid.push([u * u * 92 + 2 * u * t * 60, u * u * 88 + 2 * u * t * 150 + t * t * 119]);
    }
    const R = bodyR(-50);
    const sp = spoutPath(Math.max(6, rings + 2));
    const h = handlePath(Math.max(8, rings + 6));
    return {
      body: lathe(prof, segs, 40),
      lid: lathe(lid, segs, 40),
      knob: lathe(sphereProfile(18, Math.max(4, rings - 6)).map(([r, y]) => [r, y + 129] as Pt), Math.max(8, segs >> 1), 180),
      spout: tube(sp.path, (t) => sp.rad[Math.round(t * (sp.rad.length - 1))], tubeSegs),
      handle: tube(h, () => 14, tubeSegs),
      band: lathe([[R - 2, -58], [R + 3, -56], [R + 3, -42], [R - 2, -40]], segs, 40),
    };
  });
export const kettleM = (st: Story): M34 => mul(T(st.kx - 540, 1058 - st.ky, 0), RZ(-st.tilt));
export const chaiY = (level: number, lo = 112, hi = 236) => mix(lo, hi, level);

// The pour as a world-space curve, from the spout to the chai surface.
export const pourCurve = (st: Story, surfY: number, n = 18): V3[] | null => {
  if (!st.streaming) return null;
  const v = st.stream.match(/-?\d+\.?\d*/g);
  if (!v) return null;
  const [x1, y1, cx, cy, x2, y2] = v.map(Number);
  if (Math.abs(y2 - y1) < 3) return null;
  const tipY = 1058 - st.tip.y;
  const span = st.surface.cy - st.tip.y;
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    out.push([x - 540, tipY + (surfY - tipY) * ((y - st.tip.y) / span), 0]);
  }
  return out;
};
// A steam strand in world space.
export const steamCurve = (i: number, p: number, t0: number, z = 0): V3[] => {
  if (p < 0.02) return [];
  const v = steamPath(i, p, t0).match(/-?\d+\.?\d*/g) as string[];
  const out: V3[] = [];
  for (let k = 0; k + 1 < v.length; k += 2) out.push([Number(v[k]) - 540, 1058 - Number(v[k + 1]), z]);
  return out;
};

/* ---------- camera ---------- */
export type Cam = {
  ex: number; ey: number; ez: number;
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  fx: number; fy: number; fz: number;
  f: number; cx: number; cy: number; ortho: boolean; ppu: number;
};
export const lookCam = (
  w: number, h: number, ss: number, target: V3, elev: number, yaw: number, dist: number, scale: number,
  ortho = false, shiftX = 0, shiftY = 0,
): Cam => {
  const e = (elev * Math.PI) / 180, a = (yaw * Math.PI) / 180;
  const dir: V3 = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const F = norm([-dir[0], -dir[1], -dir[2]]);
  const R = norm([F[1] * 0 - F[2] * 1, F[2] * 0 - F[0] * 0, F[0] * 1 - F[1] * 0]);
  const U: V3 = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  return {
    ex: target[0] + dir[0] * dist, ey: target[1] + dir[1] * dist, ez: target[2] + dir[2] * dist,
    rx: R[0], ry: R[1], rz: R[2], ux: U[0], uy: U[1], uz: U[2], fx: F[0], fy: F[1], fz: F[2],
    f: ortho ? ss * scale : dist * ss * scale, cx: w / 2 + shiftX * ss, cy: h / 2 + shiftY * ss, ortho, ppu: ss * scale,
  };
};
export const project = (c: Cam, x: number, y: number, z: number) => {
  const dx = x - c.ex, dy = y - c.ey, dz = z - c.ez;
  const xc = dx * c.rx + dy * c.ry + dz * c.rz, yc = dx * c.ux + dy * c.uy + dz * c.uz, zc = dx * c.fx + dy * c.fy + dz * c.fz;
  const k = c.ortho ? c.f : c.f / zc;
  return { x: c.cx + xc * k, y: c.cy - yc * k, z: zc, k };
};

/* ---------- G-buffer and rasteriser ---------- */
export type Item = {
  mesh: Mesh; m?: M34; mat: number;
  flat?: boolean; noCast?: boolean; twoSide?: boolean; clipY?: number; tag?: number;
};
export class GBuf {
  z: Float32Array; id: Int32Array; tri: Int32Array; back: Uint8Array;
  nx: Float32Array; ny: Float32Array; nz: Float32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  u: Float32Array; v: Float32Array;
  constructor(public w: number, public h: number) {
    const n = w * h;
    this.z = new Float32Array(n); this.id = new Int32Array(n); this.tri = new Int32Array(n); this.back = new Uint8Array(n);
    this.nx = new Float32Array(n); this.ny = new Float32Array(n); this.nz = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.u = new Float32Array(n); this.v = new Float32Array(n);
  }
  clear() { this.z.fill(1e12); this.id.fill(0); this.back.fill(0); }
}

let tmpP = new Float32Array(30000), tmpN = new Float32Array(30000), tmpS = new Float32Array(30000);
const reserve = (n: number) => {
  if (tmpP.length < n * 3) {
    tmpP = new Float32Array(n * 3 + 3000); tmpN = new Float32Array(n * 3 + 3000); tmpS = new Float32Array(n * 3 + 3000);
  }
};

export function rasterize(g: GBuf, c: Cam, items: Item[], farthest = false) {
  g.clear();
  const W = g.w, H = g.h;
  const { z: zb, id: idb, tri: trib, back: backb, nx: bnx, ny: bny, nz: bnz, px: bpx, py: bpy, pz: bpz, u: bu, v: bv } = g;
  if (farthest) zb.fill(-1e12);
  for (let it = 0; it < items.length; it++) {
    const item = items[it];
    const M = item.m || I;
    const mesh = item.mesh;
    const n = mesh.p.length / 3;
    reserve(n);
    const pos = mesh.p, nor = mesh.n;
    for (let v = 0; v < n; v++) {
      const q = v * 3;
      const x = pos[q], y = pos[q + 1], z = pos[q + 2];
      const wx = M[0] * x + M[1] * y + M[2] * z + M[3];
      const wy = M[4] * x + M[5] * y + M[6] * z + M[7];
      const wz = M[8] * x + M[9] * y + M[10] * z + M[11];
      tmpP[q] = wx; tmpP[q + 1] = wy; tmpP[q + 2] = wz;
      const a = nor[q], b = nor[q + 1], d = nor[q + 2];
      tmpN[q] = M[0] * a + M[1] * b + M[2] * d;
      tmpN[q + 1] = M[4] * a + M[5] * b + M[6] * d;
      tmpN[q + 2] = M[8] * a + M[9] * b + M[10] * d;
      const dx = wx - c.ex, dy = wy - c.ey, dz = wz - c.ez;
      const xc = dx * c.rx + dy * c.ry + dz * c.rz, yc = dx * c.ux + dy * c.uy + dz * c.uz, zc = dx * c.fx + dy * c.fy + dz * c.fz;
      if (c.ortho) {
        tmpS[q] = c.cx + xc * c.f; tmpS[q + 1] = c.cy - yc * c.f; tmpS[q + 2] = 1 / (zc + 8000);
      } else {
        const iw = zc > 1 ? 1 / zc : -1;
        tmpS[q] = c.cx + xc * c.f * iw; tmpS[q + 1] = c.cy - yc * c.f * iw; tmpS[q + 2] = iw;
      }
    }
    const idx = mesh.i, uv = mesh.uv;
    const tc = idx.length / 3;
    const clip = item.clipY, hasClip = clip !== undefined;
    const flat = !!item.flat, two = !!item.twoSide || hasClip;
    for (let t = 0; t < tc; t++) {
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3;
      const iw0 = tmpS[a0 + 2], iw1 = tmpS[a1 + 2], iw2 = tmpS[a2 + 2];
      if (iw0 < 0 || iw1 < 0 || iw2 < 0) continue;
      const x0 = tmpS[a0], y0 = tmpS[a0 + 1], x1 = tmpS[a1], y1 = tmpS[a1 + 1], x2 = tmpS[a2], y2 = tmpS[a2 + 1];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area > -1e-3 && area < 1e-3) continue;
      const anx = tmpN[a0] + tmpN[a1] + tmpN[a2], any = tmpN[a0 + 1] + tmpN[a1 + 1] + tmpN[a2 + 1], anz = tmpN[a0 + 2] + tmpN[a1 + 2] + tmpN[a2 + 2];
      const facing = c.ortho
        ? anx * c.fx + any * c.fy + anz * c.fz < 0
        : anx * (c.ex - tmpP[a0]) + any * (c.ey - tmpP[a0 + 1]) + anz * (c.ez - tmpP[a0 + 2]) > 0;
      if (!facing && !two) continue;
      let fnx = anx, fny = any, fnz = anz;
      if (flat) {
        const e1x = tmpP[a1] - tmpP[a0], e1y = tmpP[a1 + 1] - tmpP[a0 + 1], e1z = tmpP[a1 + 2] - tmpP[a0 + 2];
        const e2x = tmpP[a2] - tmpP[a0], e2y = tmpP[a2 + 1] - tmpP[a0 + 1], e2z = tmpP[a2 + 2] - tmpP[a0 + 2];
        fnx = e1y * e2z - e1z * e2y; fny = e1z * e2x - e1x * e2z; fnz = e1x * e2y - e1y * e2x;
        if (fnx * anx + fny * any + fnz * anz < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
      }
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;
      const ia = 1 / area;
      const d0x = -(y2 - y1) * ia, d1x = -(y0 - y2) * ia;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5, px0 = minX + 0.5;
        let w0 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px0 - x1)) * ia;
        let w1 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px0 - x2)) * ia;
        for (let x = minX; x <= maxX; x++, w0 += d0x, w1 += d1x) {
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
          const iw = w0 * iw0 + w1 * iw1 + w2 * iw2;
          const depth = c.ortho ? 1 / iw - 8000 : 1 / iw;
          const i = y * W + x;
          if (farthest ? depth <= zb[i] : depth >= zb[i]) continue;
          const b0 = (w0 * iw0) / iw, b1 = (w1 * iw1) / iw, b2 = 1 - b0 - b1;
          const wy = b0 * tmpP[a0 + 1] + b1 * tmpP[a1 + 1] + b2 * tmpP[a2 + 1];
          if (hasClip && wy > (clip as number)) continue;
          zb[i] = depth;
          idb[i] = it + 1;
          trib[i] = t;
          backb[i] = facing ? 0 : 1;
          bpx[i] = b0 * tmpP[a0] + b1 * tmpP[a1] + b2 * tmpP[a2];
          bpy[i] = wy;
          bpz[i] = b0 * tmpP[a0 + 2] + b1 * tmpP[a1 + 2] + b2 * tmpP[a2 + 2];
          if (flat) { bnx[i] = fnx; bny[i] = fny; bnz[i] = fnz; }
          else {
            bnx[i] = b0 * tmpN[a0] + b1 * tmpN[a1] + b2 * tmpN[a2];
            bny[i] = b0 * tmpN[a0 + 1] + b1 * tmpN[a1 + 1] + b2 * tmpN[a2 + 1];
            bnz[i] = b0 * tmpN[a0 + 2] + b1 * tmpN[a1 + 2] + b2 * tmpN[a2 + 2];
          }
          bu[i] = b0 * uv[i0 * 2] + b1 * uv[i1 * 2] + b2 * uv[i2 * 2];
          bv[i] = b0 * uv[i0 * 2 + 1] + b1 * uv[i1 * 2 + 1] + b2 * uv[i2 * 2 + 1];
        }
      }
    }
  }
}

/* ---------- shadow maps ---------- */
const POISSON: Pt[] = [
  [-0.61, 0.21], [0.14, 0.73], [0.71, 0.27], [-0.24, -0.71], [0.42, -0.59], [-0.84, -0.33], [0.93, -0.22], [-0.12, 0.09],
];
export class Shadow {
  map: Float32Array;
  R: V3; U: V3; L: V3;
  k: number; cu: number; cv: number;
  constructor(public size: number, dir: V3, public target: V3, public half: number) {
    this.map = new Float32Array(size * size);
    this.L = norm(dir);
    const up: V3 = Math.abs(this.L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const L = this.L;
    this.R = norm([up[1] * L[2] - up[2] * L[1], up[2] * L[0] - up[0] * L[2], up[0] * L[1] - up[1] * L[0]]);
    const R = this.R;
    this.U = [L[1] * R[2] - L[2] * R[1], L[2] * R[0] - L[0] * R[2], L[0] * R[1] - L[1] * R[0]];
    this.k = size / (2 * half);
    this.cu = size / 2; this.cv = size / 2;
  }
  // Depth = distance along the light from the target plane; larger is closer to the light.
  render(items: Item[]) {
    const { size, R, U, L, target, map, k, cu, cv } = this;
    map.fill(-1e9);
    for (const item of items) {
      if (item.noCast) continue;
      const M = item.m || I, pos = item.mesh.p, idx = item.mesh.i;
      const n = pos.length / 3;
      reserve(n);
      for (let v = 0; v < n; v++) {
        const q = v * 3, x = pos[q], y = pos[q + 1], z = pos[q + 2];
        const wx = M[0] * x + M[1] * y + M[2] * z + M[3] - target[0];
        const wy = M[4] * x + M[5] * y + M[6] * z + M[7] - target[1];
        const wz = M[8] * x + M[9] * y + M[10] * z + M[11] - target[2];
        tmpS[q] = cu + (wx * R[0] + wy * R[1] + wz * R[2]) * k;
        tmpS[q + 1] = cv - (wx * U[0] + wy * U[1] + wz * U[2]) * k;
        tmpS[q + 2] = wx * L[0] + wy * L[1] + wz * L[2];
      }
      const clip = item.clipY;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const x0 = tmpS[a], y0 = tmpS[a + 1], z0 = tmpS[a + 2], x1 = tmpS[b], y1 = tmpS[b + 1], z1 = tmpS[b + 2], x2 = tmpS[c], y2 = tmpS[c + 1], z2 = tmpS[c + 2];
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (area > -1e-4 && area < 1e-4) continue;
        const ia = 1 / area;
        const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * ia;
            const w1 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * ia;
            const w2 = 1 - w0 - w1;
            if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
            const d = w0 * z0 + w1 * z1 + w2 * z2;
            if (clip !== undefined) continue;
            const i = y * size + x;
            if (d > map[i]) map[i] = d;
          }
      }
    }
  }
  // 1 lit, 0 shadow. `rad` is in world units; rot is a per-pixel jitter in 0..1.
  soft(x: number, y: number, z: number, rad: number, bias: number, jit: number) {
    const { size, R, U, L, target, map, k, cu, cv } = this;
    const wx = x - target[0], wy = y - target[1], wz = z - target[2];
    const su = cu + (wx * R[0] + wy * R[1] + wz * R[2]) * k;
    const sv = cv - (wx * U[0] + wy * U[1] + wz * U[2]) * k;
    const d = wx * L[0] + wy * L[1] + wz * L[2] + bias;
    const a = jit * 6.283, ca = Math.cos(a), sa = Math.sin(a);
    const r = rad * k;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const px = POISSON[i][0], py = POISSON[i][1];
      const u = (su + (px * ca - py * sa) * r) | 0, v = (sv + (px * sa + py * ca) * r) | 0;
      if (u < 0 || v < 0 || u >= size || v >= size || map[v * size + u] <= d) sum++;
    }
    return sum / 8;
  }
  hard(x: number, y: number, z: number, bias: number) {
    const { size, R, U, L, target, map, k, cu, cv } = this;
    const wx = x - target[0], wy = y - target[1], wz = z - target[2];
    const u = (cu + (wx * R[0] + wy * R[1] + wz * R[2]) * k) | 0;
    const v = (cv - (wx * U[0] + wy * U[1] + wz * U[2]) * k) | 0;
    if (u < 0 || v < 0 || u >= size || v >= size) return 1;
    return map[v * size + u] <= wx * L[0] + wy * L[1] + wz * L[2] + bias ? 1 : 0;
  }
}

// Occlusion painted onto a horizontal plane, then blurred: noiseless soft shadows for floors.
export class FloorTex {
  d: Float32Array; tmp: Float32Array;
  constructor(public res: number, public x0: number, public z0: number, public x1: number, public z1: number) {
    this.d = new Float32Array(res * res);
    this.tmp = new Float32Array(res * res);
  }
  bake(lights: { s: Shadow; w: number }[], y: number, blur: number, bias = 3) {
    const { res, d, x0, z0, x1, z1 } = this;
    let tw = 0;
    for (const l of lights) tw += l.w;
    for (let j = 0; j < res; j++) {
      const z = z0 + ((j + 0.5) / res) * (z1 - z0);
      for (let i = 0; i < res; i++) {
        const x = x0 + ((i + 0.5) / res) * (x1 - x0);
        let s = 0;
        for (const l of lights) s += l.w * l.s.hard(x, y, z, bias);
        d[j * res + i] = s / tw;
      }
    }
    boxBlur1(d, this.tmp, res, res, blur, 2);
  }
  at(x: number, z: number) {
    const { res, d, x0, z0, x1, z1 } = this;
    const u = ((x - x0) / (x1 - x0)) * res - 0.5, v = ((z - z0) / (z1 - z0)) * res - 0.5;
    if (u < 0 || v < 0 || u >= res - 1 || v >= res - 1) return 1;
    const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv;
    const a = d[iv * res + iu], b = d[iv * res + iu + 1], c = d[(iv + 1) * res + iu], e = d[(iv + 1) * res + iu + 1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
  }
}

/* ---------- buffers, post ---------- */
export function boxBlur1(a: Float32Array, tmp: Float32Array, w: number, h: number, r: number, passes: number) {
  r = Math.max(1, Math.round(r));
  const k = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      const o = y * w;
      for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s * k;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s * k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}
// Blur an interleaved rgb buffer.
export function blurRGB(c: Float32Array, w: number, h: number, r: number, passes: number) {
  const a = new Float32Array(w * h), t = new Float32Array(w * h);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < w * h; i++) a[i] = c[i * 3 + ch];
    boxBlur1(a, t, w, h, r, passes);
    for (let i = 0; i < w * h; i++) c[i * 3 + ch] = a[i];
  }
}

export class Target {
  fb: Float32Array; g: GBuf; d: Float32Array; img: ImageData | null = null;
  constructor(public w: number, public h: number, public ss: number) {
    this.fb = new Float32Array(w * h * 3);
    this.g = new GBuf(w, h);
    this.d = new Float32Array(w * h);
  }
}

export const downsample = (c: Float32Array, w: number, h: number, n: number) => {
  const dw = w >> n, dh = h >> n, step = 1 << n;
  const out = new Float32Array(dw * dh * 3);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const i = (y * step * w + x * step) * 3, o = (y * dw + x) * 3;
      out[o] = c[i]; out[o + 1] = c[i + 1]; out[o + 2] = c[i + 2];
    }
  return { c: out, w: dw, h: dh };
};
export const sampleRGB = (c: Float32Array, w: number, h: number, x: number, y: number, out: number[]) => {
  x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
  const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
  const i0 = (iy * w + ix) * 3, i1 = i0 + 3, i2 = i0 + w * 3, i3 = i2 + 3;
  for (let k = 0; k < 3; k++) {
    const a = c[i0 + k] + (c[i1 + k] - c[i0 + k]) * fx;
    const b = c[i2 + k] + (c[i3 + k] - c[i2 + k]) * fx;
    out[k] = a + (b - a) * fy;
  }
};

export function bloom(t: Target, threshold: number, strength: number, r: number) {
  const n = 2;
  const small = downsample(t.fb, t.w, t.h, n);
  const s = small.c;
  for (let i = 0; i < s.length; i += 3) {
    const l = Math.max(s[i], s[i + 1], s[i + 2]);
    const k = sstep(threshold, threshold * 1.5, l);
    s[i] *= k; s[i + 1] *= k; s[i + 2] *= k;
  }
  blurRGB(s, small.w, small.h, r, 3);
  const q = [0, 0, 0];
  const f = 1 / (1 << n);
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      sampleRGB(s, small.w, small.h, x * f, y * f, q);
      const i = (y * t.w + x) * 3;
      t.fb[i] += q[0] * strength; t.fb[i + 1] += q[1] * strength; t.fb[i + 2] += q[2] * strength;
    }
}

// Soft puffs of a colour, depth-tested against the G-buffer.
export type Puff = { x: number; y: number; z: number; r: number; a: number };
export function smoke(
  t: Target, cam: Cam, puffs: Puff[], col: V3,
  opts: { f: number; scale?: number; contrast?: number; gain?: number; drift?: number } ,
) {
  const { w, h, d, g, fb } = t;
  const { z: zb } = g;
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (const p of puffs) {
    if (p.a <= 0) continue;
    const s = project(cam, p.x, p.y, p.z);
    const R = p.r * s.k * (cam.ortho ? 1 : 1);
    const x0 = Math.max(0, Math.floor(s.x - R * 1.6)), x1 = Math.min(w - 1, Math.ceil(s.x + R * 1.6));
    const y0 = Math.max(0, Math.floor(s.y - R * 1.6)), y1 = Math.min(h - 1, Math.ceil(s.y + R * 1.6));
    if (x0 > x1 || y0 > y1) continue;
    bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1);
    const iR2 = 1 / (R * R);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - s.x, dy = y + 0.5 - s.y;
        const q = (dx * dx + dy * dy) * iR2;
        if (q > 2.5) continue;
        const i = y * w + x;
        const fade = clamp01((zb[i] - s.z) / 60);
        d[i] += p.a * Math.exp(-2.2 * q) * fade;
      }
  }
  const nS = (opts.scale ?? 0.012) / t.ss;
  const con = opts.contrast ?? 1.6;
  const gain = opts.gain ?? 1;
  const drift = opts.drift ?? 0.03;
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x;
      const D = d[i];
      if (D < 1e-3) { d[i] = 0; continue; }
      d[i] = 0;
      const n = fbm3(x * nS, y * nS + opts.f * drift, opts.f * 0.02, 3);
      const a = 1 - Math.exp(-D * gain * Math.max(0, 1 + (n - 0.5) * con * 2));
      const q = i * 3;
      fb[q] += (col[0] - fb[q]) * a;
      fb[q + 1] += (col[1] - fb[q + 1]) * a;
      fb[q + 2] += (col[2] - fb[q + 2]) * a;
    }
}

const SRGB = new Uint8ClampedArray(4097);
for (let i = 0; i <= 4096; i++) SRGB[i] = Math.round(255 * (i / 4096 <= 0.0031308 ? 12.92 * (i / 4096) : 1.055 * Math.pow(i / 4096, 1 / 2.4) - 0.055));

export type Grade = {
  exposure?: number; tone?: "aces" | "soft" | "none"; sat?: number; contrast?: number;
  vignette?: number; grain?: number; f?: number; tint?: V3; lift?: V3;
};
export function present(ctx: CanvasRenderingContext2D, t: Target, g: Grade = {}) {
  const { w, h, fb } = t;
  if (!t.img) t.img = ctx.createImageData(w, h);
  const out = t.img.data;
  const exp = g.exposure ?? 1, tone = g.tone ?? "aces", sat = g.sat ?? 1, con = g.contrast ?? 1;
  const vig = g.vignette ?? 0, grain = g.grain ?? 0, seed = g.f ?? 0;
  const tint = g.tint, lift = g.lift;
  const cx = w / 2, cy = h / 2, rr = 1 / (cx * cx + cy * cy);
  let o = 0, q = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++, q += 3, o += 4) {
      let r = fb[q] * exp, gg = fb[q + 1] * exp, b = fb[q + 2] * exp;
      if (tint) { r *= tint[0]; gg *= tint[1]; b *= tint[2]; }
      if (vig) {
        const dx = x - cx, dy = y - cy;
        const v = 1 - vig * sstep(0.25, 1.05, (dx * dx + dy * dy) * rr);
        r *= v; gg *= v; b *= v;
      }
      if (tone === "aces") {
        r = (r * (2.51 * r + 0.03)) / (r * (2.43 * r + 0.59) + 0.14);
        gg = (gg * (2.51 * gg + 0.03)) / (gg * (2.43 * gg + 0.59) + 0.14);
        b = (b * (2.51 * b + 0.03)) / (b * (2.43 * b + 0.59) + 0.14);
      } else if (tone === "soft") {
        r = r / (1 + r * 0.35) * 1.2; gg = gg / (1 + gg * 0.35) * 1.2; b = b / (1 + b * 0.35) * 1.2;
      }
      if (sat !== 1) {
        const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
      }
      if (con !== 1) { r = 0.18 * Math.pow(Math.max(r, 0) / 0.18, con); gg = 0.18 * Math.pow(Math.max(gg, 0) / 0.18, con); b = 0.18 * Math.pow(Math.max(b, 0) / 0.18, con); }
      if (lift) { r += lift[0]; gg += lift[1]; b += lift[2]; }
      if (grain) {
        const n = (h3(x, y, seed) - 0.5) * grain;
        r += n; gg += n; b += n;
      }
      out[o] = SRGB[r <= 0 ? 0 : r >= 1 ? 4096 : (r * 4096) | 0];
      out[o + 1] = SRGB[gg <= 0 ? 0 : gg >= 1 ? 4096 : (gg * 4096) | 0];
      out[o + 2] = SRGB[b <= 0 ? 0 : b >= 1 ? 4096 : (b * 4096) | 0];
      out[o + 3] = 255;
    }
  ctx.putImageData(t.img, 0, 0);
}

export const makeTarget = (w: number, h: number, ss: number) =>
  once(`target-${w}-${h}`, () => new Target(w, h, ss));

/* ---------- sampled surface points, for point-cloud work ---------- */
export const samplePoints = (mesh: Mesh, density: number, seed: number) => {
  const { p, n, i } = mesh;
  const areas: number[] = [];
  let total = 0;
  for (let t = 0; t < i.length; t += 3) {
    const a = i[t] * 3, b = i[t + 1] * 3, c = i[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    total += area;
    areas.push(total);
  }
  const count = Math.floor(total * density);
  const pts = new Float32Array(count * 6);
  let tri = 0;
  for (let k = 0; k < count; k++) {
    const target = ((k + rnd(k, seed)) / count) * total;
    while (tri < areas.length - 1 && areas[tri] < target) tri++;
    let u = rnd(k, seed + 1), v = rnd(k, seed + 2);
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = i[tri * 3] * 3, b = i[tri * 3 + 1] * 3, c = i[tri * 3 + 2] * 3;
    const w = 1 - u - v;
    for (let q = 0; q < 3; q++) {
      pts[k * 6 + q] = w * p[a + q] + u * p[b + q] + v * p[c + q];
      pts[k * 6 + 3 + q] = w * n[a + q] + u * n[b + q] + v * n[c + q];
    }
  }
  return pts;
};
