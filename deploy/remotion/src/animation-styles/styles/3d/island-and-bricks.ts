// 57 Low-poly island, 58 Brick toy.
import { storyAt } from "../../story";
import {
    I, Item,
    M34,
    MB,
    Mesh,
    RIM_Y,
    RY,
    S as Sc, Shadow, T, V3, bodyR,
    chaiY, clamp01, cyl, disk,
    handlePath, hex, ign, innerR,
    kettle, kettleM, kulhad, lookCam, merge, mix, mul,
    norm, once, outerR, paint, plane, pourCurve, present, rasterize, rnd, sphere, spoutPath, sstep, steamCurve, tube
} from "./mesh";
import type { Draw } from "./view";

/* ---------- 57 Low-poly island ---------- */
const SEA = -64;
const shore = (a: number) => 420 + 56 * Math.sin(a * 3 + 0.8) + 44 * Math.sin(a * 5 + 2.1) + 22 * Math.sin(a * 11);
const islandH = (x: number, z: number) => {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const rn = r / shore(a);
  if (rn < 0.56) return 0;
  return -sstep(0.56, 1.05, rn) * 112 + (rnd(Math.floor(a * 9), Math.floor(r / 30)) - 0.5) * 8;
};
const SAND = hex("#f1d38a"), GRASS = hex("#62b84a"), GRASS2 = hex("#3e9a46"), ROCK = hex("#8b8f9c"), TRUNK = hex("#a06a3d"), LEAF = hex("#2f9e55"), LEAF2 = hex("#55c05a");

const island = () =>
  once("island", () => {
    const m = new MB();
    const rings = 11, segs = 26;
    const P: number[][] = [];
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2 + (j % 2) * (Math.PI / segs);
        const k = j / rings;
        const R = shore(a) * k * 1.12 + (j && j < rings ? (rnd(i, j) - 0.5) * 26 : 0);
        const x = Math.cos(a) * R, z = Math.sin(a) * R * 0.9;
        P.push([x, islandH(x, z / 0.9) + (j && k > 0.58 ? (rnd(i, j + 40) - 0.5) * 10 : 0), z]);
      }
    const idx = (j: number, i: number) => j * segs + ((i + segs) % segs);
    const face = (a: number, b: number, c: number) => {
      const y = (P[a][1] + P[b][1] + P[c][1]) / 3;
      const col = y < SEA + 18 ? SAND : y < -22 ? SAND : (a + b) % 3 === 0 ? GRASS2 : GRASS;
      const k = 0.92 + (rnd(a + b, c) - 0.5) * 0.2;
      m.col = [col[0] * k, col[1] * k, col[2] * k];
      const u = m.v(P[a][0], P[a][1], P[a][2], 0, 1, 0, 0, 0), v = m.v(P[b][0], P[b][1], P[b][2], 0, 1, 0, 0, 0), w = m.v(P[c][0], P[c][1], P[c][2], 0, 1, 0, 0, 0);
      m.tri(u, v, w);
    };
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < segs; i++) {
        const a = idx(j, i), b = idx(j, i + 1), c = idx(j + 1, i), d = idx(j + 1, i + 1);
        if (j % 2) { face(a, b, d); face(a, d, c); } else { face(a, b, c); face(b, d, c); }
      }
    return m.build();
  });

const palm = (x: number, z: number, h: number, seed: number) => {
  const parts: [Mesh, M34?][] = [];
  const bend = (rnd(seed, 1) - 0.5) * 80;
  const path: V3[] = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; path.push([bend * t * t, t * h, bend * 0.3 * t * t]); }
  parts.push([paint(tube(path, (t) => mix(12, 6, t), 5, false), TRUNK, 0.24, seed)]);
  const top = path[5];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 360 + seed * 37;
    const leaf: V3[] = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; leaf.push([t * 112, 16 - t * t * 90, 0]); }
    const m = tube(leaf, (t) => 3 + 24 * Math.sin(t * Math.PI) * (1 - t * 0.4), 3, false);
    parts.push([paint(m, k % 2 ? LEAF : LEAF2, 0.26, seed + k), mul(T(top[0], top[1], top[2]), mul(RY(a), Sc(1, 0.7, 1)))]);
  }
  return merge(parts.map(([m, M]) => [m, mul(T(x, islandH(x, z / 0.9) - 2, z), M || I)]));
};
const rocks = (x: number, z: number, s: number, seed: number) =>
  merge([[paint(sphere(s, 6, 3), ROCK, 0.3, seed), mul(T(x, islandH(x, z / 0.9) + s * 0.3, z), Sc(1, 0.75, 1))]]);

const scenery57 = () =>
  once("s57", () =>
    merge(
      [
        island(),
        palm(-300, -70, 360, 1), palm(-250, 130, 250, 2), palm(290, -110, 300, 3), palm(320, 110, 210, 4),
        rocks(190, 210, 34, 5), rocks(240, 240, 20, 6), rocks(-180, 260, 26, 7), rocks(-350, 30, 18, 8),
      ].map((m) => [m] as [Mesh]),
    ),
  );
const paintKettle = (kp: ReturnType<typeof kettle>, m: M34, tag: string): Item[] => {
  const CORAL = hex("#ec5a43"), CREAM = hex("#f7e6c4"), DARK = hex("#3a3550");
  const cols: [Mesh, V3, string][] = [[kp.body, CORAL, "b"], [kp.lid, CREAM, "l"], [kp.spout, CORAL, "s"], [kp.handle, DARK, "h"], [kp.knob, CREAM, "k"], [kp.band, CREAM, "bd"]];
  return cols.map(([mesh, c, id]) => ({ mesh: once(`${tag}${id}`, () => paint(mesh, c, 0.18, id.length)), m, mat: 0, flat: true }));
};
const ocean = (f: number) => {
  const m = new MB();
  const n = 46;
  const P: number[][] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = -3600 + (i / n) * 7200 + (j % 2) * 40, z = -6500 + (j / n) * 8000;
      const y = SEA + Math.sin(x * 0.013 + f * 0.09 + z * 0.005) * 9 + Math.sin(z * 0.017 - f * 0.11 + i) * 9;
      P.push([x, y, z]);
    }
  const SEA1 = hex("#17b6c9"), SEA2 = hex("#0b8bb8"), FOAM = hex("#d9f6ee");
  const face = (a: number, b: number, c: number) => {
    const cx = (P[a][0] + P[b][0] + P[c][0]) / 3, cz = (P[a][2] + P[b][2] + P[c][2]) / 3;
    const r = Math.hypot(cx, cz / 0.9), ra = Math.atan2(cz / 0.9, cx);
    const near = 1 - sstep(1.02, 1.3, r / shore(ra));
    const base = (a + c) % 2 ? SEA1 : SEA2;
    const k = 0.9 + rnd(a, c) * 0.22;
    m.col = [mix(base[0], FOAM[0], near * 0.55) * k, mix(base[1], FOAM[1], near * 0.55) * k, mix(base[2], FOAM[2], near * 0.55) * k];
    const u = m.v(P[a][0], P[a][1], P[a][2], 0, 1, 0, 0, 0), v = m.v(P[b][0], P[b][1], P[b][2], 0, 1, 0, 0, 0), w = m.v(P[c][0], P[c][1], P[c][2], 0, 1, 0, 0, 0);
    m.tri(u, v, w);
  };
  const stride = n + 1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if ((i + j) % 2) { face(a, b, d); face(a, d, c); } else { face(a, b, c); face(b, d, c); }
    }
  return m.build();
};
const L57 = norm([-0.55, 0.62, 0.55]);
const sh57 = () => once("sh57", () => new Shadow(1200, L57, [0, 200, 0], 900));

export const draw57: Draw = (f, t, ctx) => {
  const st = storyAt(f);
  const { w, h, ss, fb, g } = t;
  const cam = lookCam(w, h, ss, [0, 385, 0], 15, 0, 1600, 1);
  const y = chaiY(st.level, 138, 236);
  const items: Item[] = [
    { mesh: ocean(f), mat: 1, flat: true, noCast: true },
    { mesh: scenery57(), mat: 0, flat: true },
    { mesh: once("k57", () => paint(kulhad(10, 2, 0), hex("#d9743a"), 0.22, 3)), mat: 0, flat: true },
    { mesh: once("d57", () => paint(disk(10), hex("#b46a2c"), 0.2, 4)), m: mul(T(0, y, 0), Sc(innerR(y) - 1, 1, innerR(y) - 1)), mat: 0, flat: true },
    ...paintKettle(kettle(9, 4, 5), kettleM(st), "pk57"),
  ];
  const c = pourCurve(st, y, 7);
  if (c) items.push({ mesh: paint(tube(c, (u) => mix(14, 10, u) * (1 + 0.1 * Math.sin(u * 9 + f)), 5), hex("#b5652a"), 0.25, f), mat: 0, flat: true });
  const puffs: [Mesh, M34?][] = [];
  st.steam.forEach((p, i) => {
    const sc = steamCurve(i, p, f * 0.05, 0);
    for (let k = 4; k < sc.length; k += 6) {
      const u = k / sc.length;
      const r = (22 + 34 * u) * sstep(0, 0.2, p);
      puffs.push([once(`puff${(k + i) % 4}`, () => paint(sphere(1, 6, 3), hex("#ffffff"), 0.1, k + i)), mul(T(sc[k][0], sc[k][1], 30), mul(RY(k * 40 + f * 3), Sc(r)))]);
    }
  });
  if (puffs.length) items.push({ mesh: merge(puffs), mat: 2, flat: true });
  // Three low clouds
  const clouds: [Mesh, M34?][] = [];
  const cloudM = once("cloud57", () => paint(sphere(1, 7, 3), hex("#fff4e4"), 0.08, 6));
  [[-620, 930, -900], [640, 1080, -1200], [-120, 1180, -1500]].forEach(([x, y0, z], k) => {
    const dx = ((f * 0.5 + k * 60) % 80) - 40;
    for (let n = 0; n < 4; n++) clouds.push([cloudM, mul(T(x + dx + n * 90 - 135, y0 + (n % 2) * 18, z), Sc(80 - Math.abs(n - 1.5) * 20, 52 - Math.abs(n - 1.5) * 12, 70))]);
  });
  items.push({ mesh: merge(clouds), mat: 3, flat: true, noCast: true });
  rasterize(g, cam, items);
  const sm = sh57();
  sm.render(items);
  const { id, tri, nx, ny, nz, px, py, pz } = g;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, q = i * 3;
      if (!id[i]) {
        const k = yy / (h * 0.3);
        fb[q] = mix(0.1, 1.0, sstep(0, 1, k));
        fb[q + 1] = mix(0.3, 0.62, sstep(0, 1, k));
        fb[q + 2] = mix(0.82, 0.5, sstep(0, 1, k));
        continue;
      }
      const it = items[id[i] - 1];
      let Nx = nx[i], Ny = ny[i], Nz = nz[i];
      const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
      Nx *= il; Ny *= il; Nz *= il;
      const col = it.mesh.col as Float32Array, tr = tri[i] * 3;
      const r0 = col[tr], g0 = col[tr + 1], b0 = col[tr + 2];
      if (it.mat === 3) { const k = 0.7 + 0.5 * Math.max(0, Nx * L57[0] + Ny * L57[1] + Nz * L57[2]); fb[q] = r0 * k * 1.25; fb[q + 1] = g0 * k * 1.15; fb[q + 2] = b0 * k * 1.1; continue; }
      const NL = Math.max(0, Nx * L57[0] + Ny * L57[1] + Nz * L57[2]);
      const X = px[i], Y = py[i], Z = pz[i];
      const lit = it.mat === 1 ? sm.hard(X, Y + 14, Z, 6) : sm.soft(X + Nx * 2, Y + Ny * 2, Z + Nz * 2, 2.5, 6, ign(xx, yy));
      const sun = 1.5 * NL * lit, amb = 0.42 + 0.3 * Ny;
      const rl = sun * 1.05 + amb * 0.62, gl = sun * 0.98 + amb * 0.78, bl = sun * 0.82 + amb * 1.04;
      fb[q] = r0 * rl; fb[q + 1] = g0 * gl; fb[q + 2] = b0 * bl;
    }
  present(ctx, t, { exposure: 1, tone: "soft", sat: 1.18, vignette: 0.12 });
};

/* ---------- 58 Brick toy ---------- */
const PITCH = 24, LH = 28.8;
type Fill = (x: number, y: number, z: number) => number;
const BLUE = hex("#1d63c8"), YELLOW = hex("#f7c61a"), RED = hex("#d3261f"), DK = hex("#2a2a30"), TC1 = hex("#c9672d"), TC2 = hex("#a9502a"), CREAM = hex("#f2dfb0"), TAN = hex("#8b4f1f"), GREEN = hex("#2f7d3b"), WHITE = hex("#f2f4f6");
const PAL: V3[] = [[0, 0, 0], BLUE, YELLOW, RED, DK, TC1, TC2, CREAM, TAN, GREEN, WHITE];

const addStud = (m: MB, x: number, y: number, z: number, c: V3) => {
  const r = PITCH * 0.31, H = LH * 0.2, seg = 10;
  m.col = c;
  const base = m.p.length / 3;
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * 6.2832, cx = Math.cos(a), sz = Math.sin(a);
    m.v(x + cx * r, y, z + sz * r, cx, 0, sz, 0, 0);
    m.v(x + cx * r, y + H, z + sz * r, cx, 0, sz, 0, 0);
  }
  for (let j = 0; j < seg; j++) m.quad(base + j * 2, base + j * 2 + 1, base + j * 2 + 3, base + j * 2 + 2);
  const cen = m.v(x, y + H, z, 0, 1, 0, 0, 0), first = m.p.length / 3;
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * 6.2832;
    m.v(x + Math.cos(a) * r, y + H, z + Math.sin(a) * r, 0, 1, 0, 0, 0);
  }
  for (let j = 0; j < seg; j++) m.tri(cen, first + j, first + j + 1);
};

const voxelize = (fill: Fill, b: [number, number, number, number, number, number], study = true) => {
  const [X0, X1, Y0, Y1, Z0, Z1] = b;
  const nx = Math.ceil((X1 - X0) / PITCH), ny = Math.ceil((Y1 - Y0) / LH), nz = Math.ceil((Z1 - Z0) / PITCH);
  const grid = new Uint8Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : grid[k * nx * ny + j * nx + i]);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        grid[k * nx * ny + j * nx + i] = fill(X0 + (i + 0.5) * PITCH, Y0 + (j + 0.5) * LH, Z0 + (k + 0.5) * PITCH);
  const m = new MB();
  const G = 0.8;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        const c = at(i, j, k);
        if (!c) { i++; continue; }
        const max = 2 + ((j + k) % 3);
        let run = 1;
        while (run < max && at(i + run, j, k) === c) run++;
        const x0 = X0 + i * PITCH + G, x1 = X0 + (i + run) * PITCH - G, y0 = Y0 + j * LH, y1 = Y0 + (j + 1) * LH - G, z0 = Z0 + k * PITCH + G, z1 = Z0 + (k + 1) * PITCH - G;
        const col = PAL[c];
        const face = (o: V3, a: V3, b2: V3, n: V3) => {
          m.col = col;
          const v0 = m.v(o[0], o[1], o[2], n[0], n[1], n[2], 0, 0);
          const v1 = m.v(o[0] + a[0], o[1] + a[1], o[2] + a[2], n[0], n[1], n[2], 0, 0);
          const v2 = m.v(o[0] + a[0] + b2[0], o[1] + a[1] + b2[1], o[2] + a[2] + b2[2], n[0], n[1], n[2], 0, 0);
          const v3 = m.v(o[0] + b2[0], o[1] + b2[1], o[2] + b2[2], n[0], n[1], n[2], 0, 0);
          m.quad(v0, v1, v2, v3);
        };
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        let frontOpen = false, backOpen = false, topOpen = false;
        for (let r = 0; r < run; r++) {
          if (!at(i + r, j, k + 1)) frontOpen = true;
          if (!at(i + r, j, k - 1)) backOpen = true;
          if (!at(i + r, j + 1, k)) topOpen = true;
        }
        if (frontOpen) face([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1]);
        if (backOpen) face([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1]);
        if (!at(i + run, j, k)) face([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0]);
        if (!at(i - 1, j, k)) face([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0]);
        if (topOpen) face([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0]);
        face([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0]);
        if (study)
          for (let r = 0; r < run; r++)
            if (!at(i + r, j + 1, k)) addStud(m, X0 + (i + r + 0.5) * PITCH, y1, Z0 + (k + 0.5) * PITCH, col);
        i += run;
      }
    }
  return m.build();
};
const cupFill: Fill = (x, y, z) => {
  const r = Math.hypot(x, z);
  if (y < 20) return r < 124 ? 6 : 0;
  if (y > RIM_Y) return 0;
  if (r < outerR(y) + 3 && r > innerR(y) - 14) return y > RIM_Y - LH ? 7 : Math.floor(y / LH) % 3 === 0 ? 6 : 5;
  return 0;
};
const sp = spoutPath(30), hp = handlePath(30);
const distPoly = (x: number, y: number, z: number, pts: V3[]) => {
  let best = 1e9, bi = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(x - pts[i][0], y - pts[i][1], z - pts[i][2]);
    if (d < best) { best = d; bi = i; }
  }
  return { d: best, t: bi / (pts.length - 1) };
};
const kettleFill: Fill = (x, y, z) => {
  const r = Math.hypot(x, z);
  if (Math.hypot(x, y - 129, z) < 24) return 3;
  if (y > 84 && y < 122 && r < 104 - (y - 84) * 2.3) return 2;
  if (y >= -140 && y <= 92) {
    const R = y < 70 ? bodyR(y) : 130 - (y - 70) * 2.5;
    if (r < R + 2) return y > -66 && y < -36 ? 2 : 1;
  }
  const s = distPoly(x, y, z, sp.path);
  if (s.d < sp.rad[Math.round(s.t * (sp.rad.length - 1))] + 3) return 1;
  if (distPoly(x, y, z, hp).d < 19) return 4;
  return 0;
};
const baseplate = () =>
  once("bp", () => {
    const m = new MB();
    const X = 39, Zn = 40;
    m.col = GREEN;
    const add = (o: V3, a: V3, b: V3, n: V3) => {
      const v0 = m.v(o[0], o[1], o[2], n[0], n[1], n[2], 0, 0), v1 = m.v(o[0] + a[0], o[1] + a[1], o[2] + a[2], n[0], n[1], n[2], 0, 0);
      const v2 = m.v(o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2], n[0], n[1], n[2], 0, 0), v3 = m.v(o[0] + b[0], o[1] + b[1], o[2] + b[2], n[0], n[1], n[2], 0, 0);
      m.quad(v0, v1, v2, v3);
    };
    const x0 = -X * PITCH, x1 = X * PITCH, z0 = -560, z1 = -560 + Zn * 2 * PITCH;
    add([x0, 0, z1], [x1 - x0, 0, 0], [0, 0, z0 - z1], [0, 1, 0]);
    for (let k = 0; k < Zn * 2; k++)
      for (let i = -X; i < X; i++) {
        const zc = z0 + (k + 0.5) * PITCH, xc = (i + 0.5) * PITCH;
        if (Math.hypot(xc, zc) < 150) continue;
        addStud(m, xc, 0, zc, GREEN);
      }
    return m.build();
  });
const cupMesh = () => once("cupb", () => voxelize(cupFill, [-192, 192, 0, 28.8 * 9, -192, 192]));
const ketMesh = () => once("ketb", () => voxelize(kettleFill, [-288, 288, -144, 28.8 * 6, -192, 192]));
const chaiLayers = () =>
  once("chaib", () => {
    const out: Mesh[] = [];
    for (let n = 0; n <= 9; n++)
      out.push(voxelize((x, y, z) => (y < 20 + n * LH && y >= 20 && Math.hypot(x, z) < innerR(y) - 14 ? 8 : 0), [-192, 192, 0, 28.8 * 9, -192, 192], true));
    return out;
  });
const roundBrick = (c: V3) => {
  const m = new MB();
  m.col = c;
  addStud(m, 0, LH * 0.84, 0, c);
  const parts = merge([[paint(cyl(PITCH * 0.47, PITCH * 0.47, LH * 0.84, 14), c, 0)], [m.build()]]);
  return parts;
};
const roundPlate = (c: V3) => {
  const m = new MB();
  addStud(m, 0, LH * 0.34, 0, c);
  return merge([[paint(cyl(PITCH * 0.47, PITCH * 0.47, LH * 0.34, 14), c, 0)], [m.build()]]);
};
const L58 = norm([-0.5, 0.74, 0.46]);
const sh58 = () => once("sh58", () => new Shadow(1400, L58, [0, 240, 0], 1100));
const dome58 = () => once("dm58", () => [[0, 1, 0], [0.7, 0.7, 0.2], [-0.7, 0.7, 0.2], [0.1, 0.7, 0.7], [0, 0.7, -0.7]].map((d) => new Shadow(512, norm(d as V3), [0, 240, 0], 1100)));

export const draw58: Draw = (f0, t, ctx) => {
  const f = Math.floor(f0 / 2) * 2;
  const st = storyAt(f);
  const { w, h, ss, fb, g } = t;
  const cam = lookCam(w, h, ss, [0, 400, 0], 24, 0, 3000, 1);
  const M = kettleM(st);
  const n = Math.round(st.level * 8);
  const items: Item[] = [
    { mesh: once("wall", () => plane(-3000, -2200, 3000, 2200)), m: mul(T(0, 700, -640), [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0]), mat: 1, noCast: true },
    { mesh: baseplate(), mat: 0 },
    { mesh: cupMesh(), mat: 0 },
    { mesh: chaiLayers()[Math.min(8, n)], mat: 0 },
    { mesh: ketMesh(), m: M, mat: 0 },
  ];
  const surf = 20 + n * LH + LH * 0.2;
  if (st.streaming) {
    const tx = Math.round((st.tip.x - 540) / PITCH) * PITCH;
    const startY = 1058 - st.tip.y - 8;
    const sN = Math.floor((startY - surf) / LH);
    const rb = once("rb", () => roundBrick(hex("#c56f24")));
    const parts: [Mesh, M34?][] = [];
    const shift = (f / 2) % 2 ? LH / 2 : 0;
    const head = st.stream.match(/-?\d+\.?\d*/g);
    const yEnd = head ? 1058 - (Number(head[5]) - st.surface.cy + st.surface.cy) : surf;
    for (let k = 0; k <= sN; k++) {
      const yy = surf + k * LH + shift;
      if (yy > startY) continue;
      const fromTip = (startY - yy) / (startY - surf);
      const headFrac = head ? Math.min(1, (Number(head[5]) - st.tip.y) / (st.surface.cy - st.tip.y)) : 1;
      const tailFrac = head ? Math.min(1, (Number(head[1]) - st.tip.y) / (st.surface.cy - st.tip.y)) : 0;
      if (fromTip > headFrac || fromTip < tailFrac) continue;
      parts.push([rb, T(tx, yy, 0)]);
    }
    if (parts.length) items.push({ mesh: merge(parts), mat: 0 });
    void yEnd;
  }
  const steamParts: [Mesh, M34?][] = [];
  st.steam.forEach((p, i) => {
    const sc = steamCurve(i, p, 0.3);
    for (let k = 2; k < sc.length; k += 3) {
      const yy = Math.round(sc[k][1] / (LH * 0.4)) * LH * 0.4;
      const xx = Math.round(sc[k][0] / PITCH) * PITCH;
      steamParts.push([once("rp", () => roundPlate(WHITE)), T(xx, yy, 0)]);
    }
  });
  if (steamParts.length) items.push({ mesh: merge(steamParts), mat: 2 });
  rasterize(g, cam, items);
  const sm = sh58();
  sm.render(items);
  const domes = dome58();
  domes.forEach((d) => d.render(items));
  const { id, tri, nx, ny, nz, px, py, pz } = g;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, q = i * 3, idv = id[i];
      if (!idv) { fb[q] = 0.3; fb[q + 1] = 0.5; fb[q + 2] = 0.8; continue; }
      const it = items[idv - 1];
      const X = px[i], Y = py[i], Z = pz[i];
      if (it.mat === 1) {
        const bh = LH * 2, bw = PITCH * 4;
        const row = Math.floor(Y / bh);
        const off = ((row % 2) + 2) % 2 ? bw / 2 : 0;
        const col = Math.floor((X + off) / bw);
        const sx = ((X + off) % bw + bw) % bw, sy = ((Y % bh) + bh) % bh;
        const seam = sx < 1.5 || sy < 1.5 ? 0.42 : 1;
        const edge = sy > bh - 4 ? 1.12 : 1;
        const jr = rnd(col * 31 + row * 7, 2);
        const B = jr < 0.5 ? hex("#efe2c2") : jr < 0.8 ? hex("#e3cfa6") : hex("#f7efd9");
        const fall = 0.42 + 0.44 * Math.exp(-Math.pow((X * X + (Y - 400) * (Y - 400)) / 720000, 1));
        fb[q] = B[0] * seam * edge * fall; fb[q + 1] = B[1] * seam * edge * fall; fb[q + 2] = B[2] * seam * edge * fall;
        continue;
      }
      let Nx = nx[i], Ny = ny[i], Nz = nz[i];
      const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
      Nx *= il; Ny *= il; Nz *= il;
      const col = it.mesh.col as Float32Array, tr = tri[i] * 3;
      const r0 = col[tr], g0 = col[tr + 1], b0 = col[tr + 2];
      const lit = sm.soft(X + Nx * 3, Y + Ny * 3, Z + Nz * 3, 4, 5, ign(xx, yy));
      const NL = Math.max(0, Nx * L58[0] + Ny * L58[1] + Nz * L58[2]);
      let occ = 0;
      for (const d of domes) occ += d.hard(X + Nx * 4, Y + Ny * 4, Z + Nz * 4, 5);
      occ /= domes.length;
      let Vx = cam.ex - X, Vy = cam.ey - Y, Vz = cam.ez - Z;
      const vl = 1 / Math.hypot(Vx, Vy, Vz);
      Vx *= vl; Vy *= vl; Vz *= vl;
      const NV = clamp01(Nx * Vx + Ny * Vy + Nz * Vz);
      const NdV = Nx * Vx + Ny * Vy + Nz * Vz;
      const Rx = 2 * NdV * Nx - Vx, Ry = 2 * NdV * Ny - Vy, Rz = 2 * NdV * Nz - Vz;
      const refl = sstep(0.8, 0.95, Rx * L58[0] + Ry * L58[1] + Rz * L58[2]);
      const strip = sstep(0.75, 0.9, Ry) * 0.4;
      const fr = 0.05 + 0.6 * Math.pow(1 - NV, 4);
      const dif = 1.55 * NL * lit + (0.3 + 0.32 * Ny) * mix(0.3, 1, occ);
      const sp = (refl * 1.9 + strip) * fr * 2.4 * mix(0.3, 1, lit);
      const trans = it.mat === 2 ? 0.2 : 0;
      fb[q] = r0 * dif + sp + trans; fb[q + 1] = g0 * dif + sp + trans; fb[q + 2] = b0 * dif + sp + trans;
    }
  present(ctx, t, { exposure: 1, tone: "aces", sat: 1.1, vignette: 0.28 });
};
