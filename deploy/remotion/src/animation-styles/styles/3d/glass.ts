// 59 Glass product.
import { storyAt } from "../../story";
import {
    GBuf, I, Item,
    Puff,
    S as Sc,
    T,
    bloom,
    blurRGB,
    chaiY, clamp01,
    disk,
    innerR,
    kettle, kettleM, kulhad, lathe, lookCam,
    mix, mul, noise3, norm, once,
    plane, pourCurve, present,
    rasterize,
    sampleRGB, smoke,
    sstep, steamCurve, tube
} from "./mesh";
import type { Draw } from "./view";

/* ---------- 59 Glass product: everything is refraction, fresnel and light on black ---------- */
const innerSolid = () =>
  once("inner59", () => {
    const pts: [number, number][] = [[0, 26], [108, 28]];
    for (let i = 0; i <= 12; i++) { const y = mix(28, 254, i / 12); pts.push([innerR(y) - 1, y]); }
    pts.push([0, 254]);
    return lathe(pts, 80, 45);
  });
const KB = norm([-0.75, 0.35, 0.55]), KR = norm([0.86, 0.12, 0.45]), KT = norm([0.1, 0.92, 0.3]);
export const draw59: Draw = (f, t, ctx) => {
  const st = storyAt(f);
  const { w, h, ss, fb, g } = t;
  const cam = lookCam(w, h, ss, [0, 400, 0], 17, 0, 3000, 1);
  const g2 = once("g59a", () => new GBuf(w, h)), g3 = once("g59b", () => new GBuf(w, h));
  const m2 = once("g59m", () => new GBuf(w >> 1, h >> 1));
  const camM = lookCam(w >> 1, h >> 1, ss / 2, [0, 400, 0], 17, 0, 3000, 1);
  const kp = kettle(96, 22, 24);
  const M = kettleM(st);
  const y = chaiY(st.level, 40, 238);
  const planeY = mix(752, 650, st.level);
  const liquidK = mul(M, Sc(0.94));
  const curve = pourCurve(st, y, 22);
  const streamM = curve ? tube(curve, (u) => mix(11, 8, u) * (1 + 0.06 * Math.sin(u * 22 + f * 0.8)), 14) : null;
  const opaque: Item[] = [
    { mesh: once("fl59", () => plane(-2600, -1200, 2600, 1500)), mat: 0, noCast: true },
    { mesh: innerSolid(), mat: 1, clipY: y },
    { mesh: kp.body, m: liquidK, mat: 1, clipY: planeY },
  ];
  if (streamM) opaque.push({ mesh: streamM, mat: 2 });
  rasterize(g, cam, opaque);
  const glass: Item[] = [
    { mesh: once("k59", () => kulhad(120, 20)), mat: 3, twoSide: true },
    { mesh: kp.body, m: M, mat: 3, twoSide: true }, { mesh: kp.lid, m: M, mat: 3, twoSide: true },
    { mesh: kp.spout, m: M, mat: 3, twoSide: true }, { mesh: kp.handle, m: M, mat: 3, twoSide: true },
    { mesh: kp.knob, m: M, mat: 3, twoSide: true },
  ];
  rasterize(g2, cam, glass);
  rasterize(g3, cam, glass, true);
  // Mirrored pass for the polished floor
  const MIR = Sc(1, -1, 1);
  const mirrored: Item[] = [
    ...glass.map((it) => ({ ...it, twoSide: false, m: mul(MIR, it.m || I) })),
    { mesh: once("d59", () => disk(72)), m: mul(MIR, mul(T(0, y, 0), Sc(innerR(y) - 1, 1, innerR(y) - 1))), mat: 1 },
  ];
  rasterize(m2, camM, mirrored);
  const mw = m2.w, mh = m2.h;
  const mb = once("mb59", () => new Float32Array(mw * mh * 3));
  for (let i = 0; i < mw * mh; i++) {
    const q = i * 3;
    if (!m2.id[i]) { mb[q] = 0; mb[q + 1] = 0; mb[q + 2] = 0; continue; }
    const mt = mirrored[m2.id[i] - 1].mat;
    let Nx = m2.nx[i], Ny = m2.ny[i], Nz = m2.nz[i];
    const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
    Nx *= il; Ny *= il; Nz *= il;
    const nz2 = Math.abs(Nz * 0.95 + Ny * 0.3);
    const rim = Math.pow(1 - nz2, 2.2);
    if (mt === 1) { mb[q] = 1.4; mb[q + 1] = 0.55; mb[q + 2] = 0.1; }
    else { mb[q] = rim * 1.3; mb[q + 1] = rim * 1.5; mb[q + 2] = rim * 1.9; }
  }
  blurRGB(mb, mw, mh, 2, 1);
  const mirrorSample = [0, 0, 0];
  const { id, nx, ny, nz, px, py, pz, back, z: zb } = g;
  let er = 0, eg = 0, eb = 0;
  const env = (x: number, y2: number, z: number) => {
    const key = sstep(0.74, 0.86, x * KB[0] + y2 * KB[1] + z * KB[2]);
    const side = sstep(0.82, 0.91, x * KR[0] + y2 * KR[1] + z * KR[2]);
    const top = sstep(0.84, 0.94, x * KT[0] + y2 * KT[1] + z * KT[2]);
    const amb = 0.012 + 0.07 * Math.max(0, y2);
    er = amb + key * 7 + side * 2 + top * 4.5;
    eg = amb + key * 7.4 + side * 3.2 + top * 5;
    eb = amb + key * 8.2 + side * 5.5 + top * 6;
  };
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, q = i * 3, idv = id[i];
      const mat = idv ? opaque[idv - 1].mat : 0;
      if (!idv || mat === 0) {
        const sy = yy / h, X = (xx - w / 2) / w, Yc = sy - 0.46;
        const halo = 0.2 * Math.exp(-(X * X * 7 + Yc * Yc * 5));
        let r = 0.012 + halo * 0.35, gg = 0.016 + halo * 0.42, b = 0.03 + halo * 0.72;
        if (idv) {
          const Wx = px[i], Wz = pz[i];
          const dist = Math.hypot(Wx, Wz);
          sampleRGB(mb, mw, mh, xx / 2, yy / 2, mirrorSample);
          const refl = 0.32 * Math.exp(-Math.abs(Wz - 120) * 0.0016);
          const fk = mix(0.4, 1, sstep(-200, -1100, Wz));
          r = r * fk + mirrorSample[0] * refl; gg = gg * fk + mirrorSample[1] * refl; b = b * fk + mirrorSample[2] * refl;
          const cx = (Wx - 130) / 180, cz = (Wz - 60) / 95;
          const ca = Math.exp(-(cx * cx + cz * cz)) * (0.55 + 0.75 * noise3(Wx * 0.03, Wz * 0.06, 3)) * (0.3 + st.level);
          r += ca * 0.9; gg += ca * 0.4; b += ca * 0.08;
          const glow = Math.exp(-dist * dist / 90000) * 0.05;
          r += glow; gg += glow; b += glow * 1.2;
        }
        fb[q] = r; fb[q + 1] = gg; fb[q + 2] = b;
        continue;
      }
      let Nx = nx[i], Ny = ny[i], Nz = nz[i];
      const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
      Nx *= il; Ny *= il; Nz *= il;
      if (back[i]) { Nx = 0; Ny = 1; Nz = 0; }
      let Vx = cam.ex - px[i], Vy = cam.ey - py[i], Vz = cam.ez - pz[i];
      const vl = 1 / Math.hypot(Vx, Vy, Vz);
      Vx *= vl; Vy *= vl; Vz *= vl;
      const NV = clamp01(Nx * Vx + Ny * Vy + Nz * Vz);
      const NdV = Nx * Vx + Ny * Vy + Nz * Vz;
      env(2 * NdV * Nx - Vx, 2 * NdV * Ny - Vy, 2 * NdV * Nz - Vz);
      const fr = 0.05 + 0.95 * Math.pow(1 - NV, 5);
      const glow = 0.55 + 0.75 * Math.pow(NV, 2.5);
      fb[q] = 0.95 * glow + er * fr; fb[q + 1] = 0.3 * glow + eg * fr; fb[q + 2] = 0.04 * glow + eb * fr;
    }
  const bgCopy = once("bg59", () => new Float32Array(w * h * 3));
  bgCopy.set(fb);
  const s3 = [0, 0, 0];
  const { id: id2, nx: nx2, ny: ny2, nz: nz2, z: z2, px: px2, py: py2, pz: pz2 } = g2;
  const { nx: bnx, ny: bny, nz: bnz, z: zBack } = g3;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      if (!id2[i] || z2[i] > zb[i]) continue;
      let Nx = nx2[i], Ny = ny2[i], Nz = nz2[i];
      const il = 1 / (Math.hypot(Nx, Ny, Nz) || 1);
      Nx *= il; Ny *= il; Nz *= il;
      let Vx = cam.ex - px2[i], Vy = cam.ey - py2[i], Vz = cam.ez - pz2[i];
      const vl = 1 / Math.hypot(Vx, Vy, Vz);
      Vx *= vl; Vy *= vl; Vz *= vl;
      let NV = Nx * Vx + Ny * Vy + Nz * Vz;
      if (NV < 0) { Nx = -Nx; Ny = -Ny; Nz = -Nz; NV = -NV; }
      NV = clamp01(NV);
      const thick = clamp01((zBack[i] - z2[i]) / 340);
      const bend = 42 * ss * (1 - NV) + 12 * ss * thick;
      sampleRGB(bgCopy, w, h, xx - Nx * bend, yy + Ny * bend, s3);
      const fr = 0.04 + 0.96 * Math.pow(1 - NV, 4.2);
      env(2 * NV * Nx - Vx, 2 * NV * Ny - Vy, 2 * NV * Nz - Vz);
      const rx = er * fr, rg = eg * fr, rb = eb * fr;
      let Bx = bnx[i], By = bny[i], Bz = bnz[i];
      const bl = 1 / (Math.hypot(Bx, By, Bz) || 1);
      Bx *= bl; By *= bl; Bz *= bl;
      const bd = 2 * (Bx * Vx + By * Vy + Bz * Vz);
      env(bd * Bx - Vx, bd * By - Vy, bd * Bz - Vz);
      const rim = Math.pow(1 - NV, 2.4);
      const tr = Math.exp(-thick * 0.55), tg = Math.exp(-thick * 0.38), tb = Math.exp(-thick * 0.2);
      const q = i * 3;
      const inner = 0.09 * (1 - fr);
      fb[q] = s3[0] * tr * (1 - fr) + rx + er * inner + rim * 0.5;
      fb[q + 1] = s3[1] * tg * (1 - fr) + rg + eg * inner + rim * 0.68;
      fb[q + 2] = s3[2] * tb * (1 - fr) + rb + eb * inner + rim * 1.0;
    }
  const pf: Puff[] = [];
  st.steam.forEach((p, i) => {
    const c = steamCurve(i, p, f * 0.04);
    c.forEach((m, k) => {
      const u = k / (c.length - 1 || 1);
      pf.push({ x: m[0], y: m[1], z: m[2], r: 14 + 30 * u * p, a: 0.08 * Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.02)) });
    });
  });
  smoke(t, cam, pf, [0.75, 0.86, 1.1], { f, scale: 0.012, contrast: 1.7, gain: 1.1 });
  bloom(t, 2.4, 0.4, 16);
  present(ctx, t, { exposure: 1, tone: "aces", vignette: 0.28, sat: 1.12 });
};

