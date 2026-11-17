// 62 Claymation and 80 Lidar survey.
import { storyAt } from "../../story";
import {
    FloorTex,
    Item, M34, Mesh,
    S as Sc, Shadow, T, V3,
    bloom,
    box, chaiY, clamp01, cyl, disk, fbm3, hex, ign, innerR,
    kettle, kettleM, kulhad, lookCam, merge, mix, mul,
    norm, once,
    plane, pourCurve, present, project, rasterize, rnd, samplePoints,
    sphere, sstep, steamCurve,
    tube
} from "./mesh";
import type { Draw } from "./view";

/* ---------- 62 Claymation: lumps, fingerprints, wrap-lit wax, boiling on threes ---------- */
const boil = (m: Mesh, seed: number, amp: number, freq: number): Mesh => {
  const n = m.p.length / 3;
  const p = new Float32Array(m.p.length);
  for (let v = 0; v < n; v++) {
    const q = v * 3, x = m.p[q], y = m.p[q + 1], z = m.p[q + 2];
    const d = (fbm3(x * freq + seed * 0.13, y * freq, z * freq + seed * 0.07, 2) - 0.5) * amp;
    p[q] = x + m.n[q] * d; p[q + 1] = y + m.n[q + 1] * d; p[q + 2] = z + m.n[q + 2] * d;
  }
  const out = new Mesh(p, m.n, m.uv, m.i);
  out.col = m.col;
  return out;
};
type Print = { u: number; v: number; r: number; ang: number; d: number };
const prints = (seed: number, n: number, uMax: number, vMax: number): Print[] =>
  Array.from({ length: n }, (_, i) => ({
    u: rnd(i, seed) * uMax, v: rnd(i, seed + 1) * vMax, r: 24 + rnd(i, seed + 2) * 26, ang: rnd(i, seed + 3) * 6.28, d: 0.7 + rnd(i, seed + 4) * 0.6,
  }));
class PGrid {
  cells = new Map<number, Print[]>();
  constructor(list: Print[]) {
    for (const p of list) {
      const R = p.r * 1.4;
      for (let a = Math.floor((p.u - R) / 90); a <= Math.floor((p.u + R) / 90); a++)
        for (let b = Math.floor((p.v - R) / 90); b <= Math.floor((p.v + R) / 90); b++) {
          const k = a * 65536 + b;
          const c = this.cells.get(k);
          if (c) c.push(p); else this.cells.set(k, [p]);
        }
    }
  }
  at(u: number, v: number) { return this.cells.get(Math.floor(u / 90) * 65536 + Math.floor(v / 90)) || EMPTY; }
}
const EMPTY: Print[] = [];
const printHeight = (u: number, v: number, list: Print[], freq: number) => {
  let h = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const du = u - p.u, dv = v - p.v;
    if (du > p.r || du < -p.r || dv > p.r * 1.35 || dv < -p.r * 1.35) continue;
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    const ax = (du * ca + dv * sa) / p.r, ay = (-du * sa + dv * ca) / (p.r * 1.35);
    const dd = ax * ax + ay * ay;
    if (dd > 1) continue;
    const f = (1 - dd) * (1 - dd);
    const swirl = Math.sqrt(ax * ax + ay * ay * 1.7) * 8 + 0.6 * Math.sin(ax * 3 + ay * 5);
    h += p.d * f * (-4.5 + 1.6 * Math.sin(swirl * freq));
  }
  return h;
};
const L62 = norm([-0.5, 0.68, 0.55]);
const sh62 = () => once("sh62", () => new Shadow(1200, L62, [0, 300, 0], 1300));
const dome62 = () => once("d62", () => [[0, 1, 0.1], [0.7, 0.7, 0.2], [-0.7, 0.7, 0.2], [0.1, 0.65, 0.75], [0, 0.72, -0.7]].map((d) => new Shadow(300, norm(d as V3), [0, 300, 0], 1300)));
const COL62: Record<number, V3> = {
  0: hex("#d69c3e"), 1: hex("#a9c3d6"), 2: hex("#c95a2b"), 3: hex("#7a4018"), 4: hex("#3fb39a"), 5: hex("#f2d34a"), 6: hex("#d8382f"), 7: hex("#f5f0e2"),
};

export const draw62: Draw = (f0, t, ctx) => {
  const f = Math.floor(f0 / 3) * 3;
  const st = storyAt(f);
  const { w, h, ss, fb, g } = t;
  const cam = lookCam(w, h, ss, [0, 400, 0], 21, 0, 2700, 1);
  const seed = Math.floor(f / 3);
  const kp = kettle(64, 16, 16);
  const M = kettleM(st);
  const y = chaiY(st.level, 118, 236);
  const items: Item[] = [
    { mesh: once("fl62", () => plane(-2400, -420, 2400, 1700)), mat: 0, noCast: true },
    { mesh: once("wl62", () => plane(-2400, -1900, 2400, 1900)), m: mul(T(0, 1500, -420), [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0]), mat: 1, noCast: true },
    { mesh: boil(once("k62", () => kulhad(72, 14)), seed, 10, 0.022), mat: 2 },
    { mesh: once("d62b", () => disk(72)), m: mul(T(0, y, 0), Sc(innerR(y) - 2, 1, innerR(y) - 2)), mat: 3 },
    { mesh: boil(kp.body, seed + 3, 12, 0.02), m: M, mat: 4 },
    { mesh: boil(kp.spout, seed + 4, 7, 0.03), m: M, mat: 4 },
    { mesh: boil(kp.lid, seed + 5, 8, 0.025), m: M, mat: 5 },
    { mesh: boil(kp.knob, seed + 6, 4, 0.05), m: M, mat: 6 },
    { mesh: boil(kp.handle, seed + 7, 7, 0.03), m: M, mat: 6 },
    { mesh: boil(kp.band, seed + 8, 5, 0.03), m: M, mat: 5 },
  ];
  const c = pourCurve(st, y, 16);
  if (c) items.push({ mesh: boil(tube(c, (u) => mix(15, 11, u) * (1 + 0.18 * Math.sin(u * 12 + seed * 1.7)), 12), seed + 9, 4, 0.05), mat: 3 });
  st.steam.forEach((p, i) => {
    const sc = steamCurve(i, p, seed * 0.03);
    if (sc.length > 3) items.push({ mesh: boil(tube(sc.filter((_, k) => k % 2 === 0), (u) => (11 + 5 * Math.sin(u * 3.14)) * (1 + 0.22 * Math.sin(u * 16)), 10), seed + 11 + i, 4, 0.05), mat: 7 });
  });
  rasterize(g, cam, items);
  const sm = sh62();
  sm.render(items);
  const domes = dome62();
  domes.forEach((d) => d.render(items));
  const ft = once("ft62", () => new FloorTex(320, -1400, -420, 1400, 1500));
  ft.bake([{ s: sm, w: 1.4 }, ...domes.map((s) => ({ s, w: 0.5 }))], 0, 5, 4);
  const { id, nx, ny, nz, px, py, pz, u, v } = g;
  const prSeedA = Math.floor(f / 12);
  const P_CUP = once(`p62c${prSeedA}`, () => new PGrid(prints(11 + prSeedA, 26, 830, 620)));
  const P_K = once(`p62k${prSeedA}`, () => new PGrid(prints(23 + prSeedA, 40, 640, 430)));
  const P_WALL = once("p62w", () => new PGrid(prints(5, 26, 3200, 2400)));
  const P_FL = once("p62f", () => new PGrid(prints(9, 24, 3200, 2000)));
  const P_TUBE = once("p62t", () => new PGrid(prints(15, 18, 240, 800)));
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, q = i * 3, idv = id[i];
      if (!idv) { fb[q] = 0.3; fb[q + 1] = 0.4; fb[q + 2] = 0.55; continue; }
      const it = items[idv - 1];
      let Nx = nx[i], Ny = ny[i], Nz = nz[i];
      const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
      Nx *= il; Ny *= il; Nz *= il;
      const X = px[i], Y = py[i], Z = pz[i];
      const mat = it.mat;
      // Texture coordinates in world units, wrapping on the surface
      let U = u[i], W = v[i];
      if (mat === 0) { U = X + 1600; W = Z + 400; }
      else if (mat === 1) { U = X + 1600; W = Y; }
      const list = (mat === 0 ? P_FL : mat === 1 ? P_WALL : mat === 2 ? P_CUP : mat === 4 || mat === 5 ? P_K : P_TUBE).at(U, W);
      const fr = mat <= 1 ? 3.4 : 6.5;
      const e = 1;
      const h0 = printHeight(U, W, list, fr);
      const hu = printHeight(U + e, W, list, fr) - h0, hv = printHeight(U, W + e, list, fr) - h0;
      const nS = mat > 1 ? 0.018 : 0.009;
      const n0 = fbm3(U * nS, W * nS, seed * 0.03 + idv, 2);
      const n1 = fbm3((U + 4) * nS, W * nS, seed * 0.03 + idv, 2) - n0, n2 = fbm3(U * nS, (W + 4) * nS, seed * 0.03 + idv, 2) - n0;
      // Tangent frame
      let Tx = Ny * 0 - Nz * 1, Tz = Nx * 1 - Ny * 0;
      const Ty0 = Nz * 0 - Nx * 0;
      let tl = Math.hypot(Tx, Ty0, Tz);
      if (tl < 0.2) { Tx = 1; Tz = 0; tl = 1; }
      Tx /= tl; Tz /= tl;
      const Bx = Ny * Tz, By = Nz * Tx - Nx * Tz, Bz = -Ny * Tx;
      const bump = mat > 1 ? 7 : 5;
      const dU = (hu / e) * 0.55 + n1 * bump, dV = (hv / e) * 0.55 + n2 * bump;
      Nx -= Tx * dU + Bx * dV; Ny -= By * dV; Nz -= Tz * dU + Bz * dV;
      const ln = 1 / Math.hypot(Nx, Ny, Nz);
      Nx *= ln; Ny *= ln; Nz *= ln;
      const c0 = COL62[mat];
      const tint = 0.95 + (n0 - 0.5) * 0.25 + h0 * 0.02;
      const jit = ign(xx, yy);
      const lit = mat <= 1 && Y < 1 ? ft.at(X, Z) : sm.soft(X + Nx * 4, Y + Ny * 4, Z + Nz * 4, 8, 6, jit);
      let occ = 0;
      if (mat === 0 && Y < 1) occ = 0.5 + 0.5 * lit;
      else {
        for (const d of domes) occ += d.hard(X + Nx * 10, Y + Ny * 10, Z + Nz * 10, 8);
        occ /= domes.length;
      }
      const dotL = Nx * L62[0] + Ny * L62[1] + Nz * L62[2];
      const NL = Math.max(0, dotL);
      const wrap = Math.max(0, (dotL + 0.5) / 1.5);
      let Vx = cam.ex - X, Vy = cam.ey - Y, Vz = cam.ez - Z;
      const vl = 1 / Math.hypot(Vx, Vy, Vz);
      Vx *= vl; Vy *= vl; Vz *= vl;
      const Hx = L62[0] + Vx, Hy = L62[1] + Vy, Hz = L62[2] + Vz;
      const hl = 1 / Math.hypot(Hx, Hy, Hz);
      const NH = clamp01((Nx * Hx + Ny * Hy + Nz * Hz) * hl);
      const NV = clamp01(Nx * Vx + Ny * Vy + Nz * Vz);
      const sheen = Math.pow(NH, 16) * 0.26 * lit + Math.pow(1 - NV, 3.5) * 0.14;
      const dep = mat === 2 && Nx * X + Nz * Z < 0 ? mix(0.42, 1, sstep(50, 250, Y)) : 1;
      const key = 1.15 * NL * lit + 0.42 * (wrap - NL * 0.9) * mix(0.5, 1, lit);
      const amb = (0.32 + 0.22 * Ny) * mix(0.35, 1, occ);
      const a = (key + amb) * dep * tint;
      // Warm bleed through the terminator, the look of light entering soft clay
      const bleed = Math.max(0, wrap - NL) * 0.32 * mix(0.6, 1, lit);
      fb[q] = c0[0] * a + c0[0] * bleed * 1.1 + sheen;
      fb[q + 1] = c0[1] * a + c0[1] * bleed * 0.35 + sheen;
      fb[q + 2] = c0[2] * a + c0[2] * bleed * 0.1 + sheen * 0.9;
    }
  present(ctx, t, { exposure: 0.95, tone: "aces", sat: 1.06, vignette: 0.22 });
};

/* ---------- 80 Lidar survey: rings on the ground, return-point shells, a rotating sweep ---------- */
const SENSOR: V3 = [-220, 640, 1180];
const lidarCloud = () =>
  once("lc80", () => {
    const kp = kettle(64, 18, 16);
    const kmesh = merge([[kp.body], [kp.lid], [kp.knob], [kp.spout], [kp.handle], [kp.band]]);
    const clutter = merge([
      [box(-720, 0, -560, -520, 150, -380)], [box(-460, 0, -660, -300, 230, -520)], [box(420, 0, -640, 660, 180, -470)],
      [box(560, 0, 90, 700, 95, 230)], [cyl(70, 70, 120, 24), T(-630, 0, 20)], [cyl(52, 40, 60, 20), T(-300, 0, 460)],
      [sphere(62, 18, 10), T(390, 62, 480)],
    ]);
    const ring: number[] = [];
    let n = 0;
    for (let k = 0; k < 210; k++) {
      const r = 190 + k * k * 0.048 + k * 7;
      const cnt = 180 + k * 8;
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * Math.PI * 2 + rnd(k, 1) * 0.02;
        const jx = (rnd(n, 2) - 0.5) * 2.4, jz = (rnd(n, 3) - 0.5) * 2.4;
        const x = SENSOR[0] + Math.cos(a) * r + jx, z = SENSOR[2] + Math.sin(a) * r + jz;
        if (Math.abs(x) > 1500 || z > 1500 || z < -1600) continue;
        ring.push(x, z);
        n++;
      }
    }
    const scat = 22000;
    const steam: number[] = [];
    for (let i = 0; i < scat; i++) steam.push(rnd(i, 21), rnd(i, 22), rnd(i, 23), rnd(i, 24));
    return {
      kettle: samplePoints(kmesh, 0.16, 3),
      cup: samplePoints(once("kc80", () => kulhad(96, 16)), 0.22, 4),
      disk: samplePoints(once("dc80", () => disk(64)), 0.022 * 20000, 5),
      clutter: samplePoints(clutter, 0.07, 7),
      ring: new Float32Array(ring),
      steam: new Float32Array(steam),
    };
  });
const ramp = (t0: number, o: number[]) => {
  const t = clamp01(t0);
  const stops: V3[] = [[0.1, 0.1, 0.9], [0.05, 0.85, 1], [0.1, 1, 0.3], [1, 0.95, 0.15], [1, 0.3, 0.1]];
  const v = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(v)), fr = v - i;
  for (let k = 0; k < 3; k++) o[k] = mix(stops[i][k], stops[i + 1][k], fr);
};
const lidarGround = (x: number, z: number) => 8 * fbm3(x * 0.004, z * 0.004, 2, 3) + 6 * Math.sin(x * 0.0024 + z * 0.0018);

export const draw80: Draw = (f, t, ctx) => {
  const st = storyAt(f);
  const { w, h, ss, fb } = t;
  fb.fill(0);
  const yaw = -13 + (f / 150) * 22;
  const cam = lookCam(w, h, ss, [0, 380, 0], 25, yaw, 3000, 1);
  const data = lidarCloud();
  const kp = kettle(40, 12, 12);
  const M = kettleM(st);
  const occl = once("oc80", () => new Shadow(1200, norm([SENSOR[0], SENSOR[1] - 140, SENSOR[2]]), [0, 200, 0], 1600));
  const y = chaiY(st.level, 118, 236);
  const items: Item[] = [
    { mesh: once("ko80", () => kulhad(40, 8)), mat: 0 },
    { mesh: kp.body, m: M, mat: 0 }, { mesh: kp.lid, m: M, mat: 0 }, { mesh: kp.spout, m: M, mat: 0 }, { mesh: kp.handle, m: M, mat: 0 },
  ];
  occl.render(items);
  const sweep = -Math.PI / 2 - 0.1 + Math.sin(f * 0.09) * 0.92;
  const sCx = SENSOR[0], sCz = SENSOR[2];
  const c1 = [0, 0, 0];
  const gain = 2.6;
  const plot = (X: number, Y: number, Z: number, cr: number, cg: number, cb: number, size: number) => {
    const s = project(cam, X, Y, Z);
    const px = s.x, py = s.y;
    if (px < 1 || py < 1 || px >= w - 2 || py >= h - 2) return;
    const R = size * ss;
    if (R <= 1.05) {
      const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy;
      const a = (iy * w + ix) * 3;
      const put = (i: number, k: number) => { fb[i] += cr * k; fb[i + 1] += cg * k; fb[i + 2] += cb * k; };
      put(a, (1 - fx) * (1 - fy)); put(a + 3, fx * (1 - fy)); put(a + w * 3, (1 - fx) * fy); put(a + w * 3 + 3, fx * fy);
    } else {
      const ri = Math.ceil(R);
      const ix = Math.round(px), iy = Math.round(py);
      for (let dy = -ri; dy <= ri; dy++)
        for (let dx = -ri; dx <= ri; dx++) {
          const d = (dx * dx + dy * dy) / (R * R);
          if (d > 1 || iy + dy < 0 || iy + dy >= h || ix + dx < 0 || ix + dx >= w) continue;
          const i = ((iy + dy) * w + ix + dx) * 3, k = 1 - d;
          fb[i] += cr * k; fb[i + 1] += cg * k; fb[i + 2] += cb * k;
        }
    }
  };
  // Brightness: a fresh return glows, then settles to its stored level.
  const pulse = (X: number, Z: number) => {
    const a = Math.atan2(Z - sCz, X - sCx);
    let d = Math.abs(sweep - a);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return 0.85 + 4.2 * Math.exp(-d * 14);
  };
  const elevBand = (X: number, Y: number, Z: number) => {
    const dist = Math.hypot(X - SENSOR[0], Z - SENSOR[2]);
    const el = Math.atan2(Y - SENSOR[1], dist);
    return ((el * 180) % 1 + 1) % 1 < 0.42;
  };
  const shoot = (arr: Float32Array, m: M34 | null, hRange: number, band: boolean, tint?: V3) => {
    for (let k = 0; k < arr.length; k += 6) {
      const x = arr[k], y2 = arr[k + 1], z = arr[k + 2], nx = arr[k + 3], ny = arr[k + 4], nz = arr[k + 5];
      let X = x, Y = y2, Z = z, Nx = nx, Ny = ny, Nz = nz;
      if (m) {
        X = m[0] * x + m[1] * y2 + m[2] * z + m[3]; Y = m[4] * x + m[5] * y2 + m[6] * z + m[7]; Z = m[8] * x + m[9] * y2 + m[10] * z + m[11];
        Nx = m[0] * nx + m[1] * ny + m[2] * nz; Ny = m[4] * nx + m[5] * ny + m[6] * nz; Nz = m[8] * nx + m[9] * ny + m[10] * nz;
      }
      const dx = SENSOR[0] - X, dy = SENSOR[1] - Y, dz = SENSOR[2] - Z;
      if (Nx * dx + Ny * dy + Nz * dz < 0) continue;
      if (occl.hard(X, Y + 3, Z, 5) < 1) continue;
      if (band && !elevBand(X, Y, Z)) continue;
      const p = pulse(X, Z) * gain * 0.62;
      if (tint) { c1[0] = tint[0]; c1[1] = tint[1]; c1[2] = tint[2]; } else ramp(Y / hRange, c1);
      plot(X, Y, Z, c1[0] * p, c1[1] * p, c1[2] * p, 1);
    }
  };
  // Ground rings, height-graded from a warped elevation
  const r = data.ring;
  for (let k = 0; k < r.length; k += 2) {
    const X = r[k], Z = r[k + 1];
    if (occl.hard(X, 4, Z, 4) < 1) continue;
    const Y = lidarGround(X, Z);
    const p = pulse(X, Z) * gain * 0.42;
    ramp(0.04 + Y / 70, c1);
    plot(X, Y, Z, c1[0] * p, c1[1] * p, c1[2] * p, 1);
  }
  shoot(data.clutter, null, 900, true);
  shoot(data.cup, null, 900, true);
  shoot(data.kettle, M, 900, true);
  // Chai as a warm-coded return
  const dsc = mul(T(0, y, 0), Sc(innerR(y) - 2, 1, innerR(y) - 2));
  shoot(data.disk, dsc, 900, false, [1, 0.42, 0.06]);
  const c = pourCurve(st, y, 80);
  if (c)
    for (let k = 0; k < c.length; k++)
      for (let j = 0; j < 5; j++) {
        const a = rnd(k, j + 40) * 6.28, rr = 7 + rnd(k, j + 41) * 5;
        plot(c[k][0] + Math.cos(a) * rr, c[k][1], c[k][2] + Math.sin(a) * rr, 1.4, 0.55, 0.08, 1.05);
      }
  // Steam: drifting, sparse, cool returns
  const sd = data.steam;
  st.steam.forEach((p, si) => {
    if (p < 0.03) return;
    const sc = steamCurve(si, p, f * 0.06);
    for (let k = 0; k < sd.length; k += 4) {
      const idx = Math.floor(sd[k] * (sc.length - 1)) ;
      const q = sc[idx];
      if (!q) continue;
      const spread = 8 + 60 * (idx / sc.length);
      const a = sd[k + 1] * 6.28 + f * 0.05, rr = Math.sqrt(sd[k + 2]) * spread;
      if ((k / 4) % 3 !== si) continue;
      const v = 0.22 * pulse(q[0], q[2]);
      plot(q[0] + Math.cos(a) * rr, q[1] + sd[k + 3] * 26 - 13, q[2] + Math.sin(a) * rr, 0.55 * v, 0.95 * v, 1.2 * v, 1);
    }
  });
  // The sweep: a bright beam across the ground
  const beamN = 900;
  const ca = Math.cos(sweep), sa = Math.sin(sweep);
  for (let b = 0; b < beamN; b++) {
    const rr = 80 + (b / beamN) * 3400;
    const X = sCx + ca * rr, Z = sCz + sa * rr;
    if (X < -1800 || X > 1800 || Z > 1700 || Z < -1800) continue;
    plot(X, lidarGround(X, Z) + 2, Z, 1.4, 2, 2.4, 1.1);
    if (b % 2 === 0) for (let e = 1; e < 8; e++) plot(X, lidarGround(X, Z) + e * 26, Z, 0.16 / e, 0.5 / e, 0.6 / e, 1);
  }
  bloom(t, 0.9, 0.22, 5);
  present(ctx, t, { exposure: 1, tone: "none", sat: 1.15, lift: [0.003, 0.005, 0.009] });
};
