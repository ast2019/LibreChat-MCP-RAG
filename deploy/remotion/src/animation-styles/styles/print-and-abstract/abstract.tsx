import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { Raster, Story, clamp01, lerp, paths, pts, rng } from "./util";

const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Three wavy fingers that never cross, so the outline stays one clean shape.
// Rotate each outline's starting point so points travel the shortest way, not across the shape.
/* ---------- 87 Liquid motion: glossy gooey fluid, blobs stretch, pinch off and merge ---------- */
const wallX = (y: number, inset: number) => {
  const t = (y - 800) / 240;
  return { l: 370 + 55 * t + inset, r: 710 - 55 * t - inset };
};

const goo = (id: string, blur: number, surface: number, shine: number) => (
  <filter id={id} {...region}>
    <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
    <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13" result="g" />
    <feGaussianBlur in="g" stdDeviation={blur * 0.65} result="h" />
    <feSpecularLighting in="h" surfaceScale={surface} specularConstant={shine} specularExponent={30} lightingColor="#ffffff" result="sp">
      <fePointLight x={280} y={120} z={520} />
    </feSpecularLighting>
    <feComposite in="sp" in2="g" operator="in" result="lit" />
    <feComposite in="g" in2="lit" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} />
  </filter>
);

const Drops: React.FC<{ s: Story; f: number; landY: number }> = ({ s, f, landY }) => {
  if (!s.streaming) return null;
  const hd = interpolate(f, [42, 47], [0, 1], cl);
  const tl = interpolate(f, [96, 101], [0, 1], cl);
  const blobs: React.ReactNode[] = [];
  const n = 42;
  for (let i = 0; i < n; i++) {
    const t = ((i / n + f * 0.055) % 1 + 1) % 1;
    if (t > hd || t < tl) continue;
    const g = t * t * 0.45 + t * 0.55;
    const x = lerp(s.tip.x, 548, g) + Math.sin(i * 1.7 + f * 0.33) * (2 + 7 * t);
    const y = lerp(s.tip.y, landY, g);
    const r = 19 + 6 * Math.sin(i * 2.3 + f * 0.5) - t * 3;
    blobs.push(<ellipse key={i} cx={x} cy={y} rx={r * 0.92} ry={r * (1 + t * 1.2)} fill="#f0a02a" />);
  }
  return (
    <>
      <path d={`M${s.tip.x},${s.tip.y} Q${s.tip.x - 8},${(s.tip.y + landY) / 2} 548,${landY}`} fill="none" stroke="#f0a02a" strokeWidth={22} pathLength={1}
        strokeDasharray={`${hd - tl} 1`} strokeDashoffset={-tl} />
      {blobs}
    </>
  );
};

const Splash: React.FC<{ f: number; landY: number; cx: number }> = ({ f, landY, cx }) => {
  const on = interpolate(f, [46, 50, 96, 106], [0, 1, 1, 0], cl);
  if (on <= 0) return null;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < 12; i++) {
    const period = 16 + (i % 5) * 3;
    const ph = (f + i * 5) / period;
    const t = ph - Math.floor(ph);
    const r = rng(8700 + i * 31 + Math.floor(ph) * 7);
    const vx = (r() - 0.5) * 240;
    const vy = 110 + r() * 150;
    const x = cx + vx * t;
    const y = landY - vy * t + 260 * t * t;
    if (y > landY + 8) continue;
    out.push(<circle key={i} cx={x} cy={y} r={(13 - 8 * t) * on} fill="#f0a02a" />);
  }
  return <>{out}</>;
};

export const LiquidMotion: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const prev = storyAt(Math.max(0, f - 1));
  const vel = clamp01(Math.abs(s.kx - prev.kx) / 40);
  const yt = 1046 - 238 * s.level;
  const wl = wallX(yt, 16);
  const wb = wallX(1042, 16);
  // Liquid body with a sloshing top.
  const amp = 12 * Math.sin(clamp01(s.level * 3.4) * Math.PI * 0.5) * interpolate(f, [100, 130], [1, 0.3], cl);
  let top = "";
  const seg = 26;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const x = lerp(wl.l, wl.r, u);
    const y = yt + Math.sin(u * 7 + f * 0.34) * amp + Math.sin(u * 15 - f * 0.5) * amp * 0.34;
    top += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  const fill = `${top} L${wb.r},1042 Q540,1068 ${wb.l},1042 Z`;
  const wob = (Math.sin(f * 0.31) + Math.sin(f * 0.17 + 1)) * 2.4;
  const amb = [
    { x: 190 + Math.sin(f * 0.031) * 80, y: 300 + Math.cos(f * 0.027) * 120, r: 210 },
    { x: 860 + Math.sin(f * 0.024 + 2) * 70, y: 980 + Math.cos(f * 0.033) * 110, r: 250 },
    { x: 330 + Math.sin(f * 0.04 + 1) * 180, y: 560 + Math.cos(f * 0.021) * 150, r: 120 },
    { x: 780 + Math.cos(f * 0.035) * 160, y: 660 + Math.sin(f * 0.029) * 170, r: 140 },
    { x: 120 + Math.cos(f * 0.05) * 60, y: 1120 + Math.sin(f * 0.04) * 90, r: 170 },
  ];
  return (
    <Stage bg="#170a2e" defs={
      <>
        <linearGradient id="lq-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#25094c" />
          <stop offset="1" stopColor="#0d1f4a" />
        </linearGradient>
        {goo("lq-g1", 16, 9, 0.9)}
        {goo("lq-g2", 10, 8, 1.1)}
        <filter id="lq-amb" {...region}>
          <feGaussianBlur in="SourceGraphic" stdDeviation={30} result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -12" />
        </filter>
      </>
    }>
      <rect width={W} height={H} fill="url(#lq-bg)" />
      <g filter="url(#lq-amb)">
        {amb.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={i % 2 ? "#23175f" : "#2d1868"} />)}
      </g>

      {/* Clear clay cup, back half */}
      <path d={P.kulhadBody} fill="#d86a3e" opacity={0.3} />
      <g filter="url(#lq-g2)">
        <path d={`M370,800 A170,42 0 0,1 710,800`} fill="none" stroke="#e7774a" strokeWidth={22} strokeLinecap="round" />
      </g>

      {/* All the chai is one fluid */}
      <g filter="url(#lq-g1)">
        {s.level > 0 ? <path d={fill} fill="#f0a02a" /> : null}
        <Drops s={s} f={f} landY={yt + 8} />
        <Splash f={f} landY={yt} cx={548} />
        {f >= 96 && f < 118
          ? [0, 1, 2].map((i) => {
              const t = clamp01((f - 98 - i * 6) / 18);
              return <circle key={i} cx={s.tip.x} cy={s.tip.y + 260 * t * t + 14} r={16 - i * 2} fill="#f0a02a" />;
            })
          : null}
      </g>

      {/* Cup front */}
      <g filter="url(#lq-g2)">
        <path d={`M370,800 A170,42 0 0,0 710,800`} fill="none" stroke="#e7774a" strokeWidth={24} strokeLinecap="round" />
        <path d={P.kulhadOutline} fill="none" stroke="#e7774a" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Kettle: a soft body, stretched by its own speed */}
      <g filter="url(#lq-g1)">
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt + wob * 0.4}) scale(${1 + vel * 0.34 + wob * 0.004} ${1 - vel * 0.2 - wob * 0.004})`}>
          <path d={P.kettleHandle} fill="none" stroke="#7fe6d0" strokeWidth={34} strokeLinecap="round" />
          <path d={P.kettleSpout} fill="#7fe6d0" />
          <path d={P.kettleBody} fill="#7fe6d0" />
          <path d={P.kettleLid} fill="#7fe6d0" stroke="#7fe6d0" strokeWidth={12} />
          <circle cx={KNOB.x} cy={KNOB.y + Math.sin(f * 0.4) * 4} r={KNOB.r + 8} fill="#7fe6d0" />
        </g>
      </g>

      {/* Steam blobs pinch off and merge as they rise */}
      <g filter="url(#lq-g2)" opacity={0.95}>
        {s.steam.flatMap((p, i) => {
          if (p <= 0) return [];
          const line = pts(steamPath(i, p, f * 0.05));
          const out: React.ReactNode[] = [];
          for (let k = 0; k < 15; k++) {
            const t = ((k / 15 + f * 0.018 + i * 0.13) % 1) * 0.98;
            const q = line[Math.floor(t * (line.length - 1))];
            const r = (38 - t * 20) * (0.82 + 0.26 * Math.sin(k * 3.1 + f * 0.23));
            out.push(<circle key={`${i}-${k}`} cx={q.x} cy={q.y} r={r} fill="#f7ecff" opacity={1 - t * 0.2} />);
          }
          return out;
        })}
      </g>
    </Stage>
  );
};

/* ---------- 89 Generative abstract: a vector field and particle systems, all fed by storyAt ---------- */
type GP = { x: number; y: number; a: number; b: number; c: number };

let GEN: { kettle: GP[]; cup: GP[]; rim: GP[] } | null = null;
const genInit = () => {
  if (GEN) return GEN;
  const probe = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  const p = paths();
  const r = rng(8901);
  const kettle: GP[] = [];
  let tries = 0;
  probe.lineWidth = 34;
  while (kettle.length < 3200 && tries++ < 90000) {
    const x = -290 + r() * 570;
    const y = -170 + r() * 330;
    const inside =
      probe.isPointInPath(p.kettleBody, x, y) ||
      probe.isPointInPath(p.kettleSpout, x, y) ||
      probe.isPointInPath(p.kettleLid, x, y) ||
      probe.isPointInStroke(p.kettleHandle, x, y) ||
      Math.hypot(x - KNOB.x, y - KNOB.y) < KNOB.r;
    if (inside) kettle.push({ x, y, a: r(), b: r(), c: r() });
  }
  const cup: GP[] = [];
  tries = 0;
  while (cup.length < 3400 && tries++ < 60000) {
    const x = 365 + r() * 350;
    const y = 795 + r() * 285;
    if (probe.isPointInPath(p.kulhadBody, x, y) || probe.isPointInPath(p.rim, x, y)) cup.push({ x, y, a: r(), b: r(), c: r() });
  }
  const rim: GP[] = [];
  for (let i = 0; i < 520; i++) {
    const a = (i / 520) * Math.PI * 2;
    rim.push({ x: 540 + Math.cos(a) * 170, y: 800 + Math.sin(a) * 42, a: r(), b: r(), c: r() });
  }
  GEN = { kettle, cup, rim };
  return GEN;
};

const STEAM_X = [470, 540, 610];

const generate = (c: CanvasRenderingContext2D, s: Story, f: number) => {
  const g = genInit();
  c.fillStyle = "#04050b";
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = "lighter";

  const exit = interpolate(f, [102, 126], [0, 1], cl);
  const pourAmt = s.streaming ? 1 : 0;
  const steamAmt = Math.max(s.steam[0], s.steam[1], s.steam[2]);
  const surf = s.surface;

  // Vector field: a lattice of strokes whose direction bends toward whatever the story is doing.
  const step = 30;
  c.lineWidth = 2.8;
  c.lineCap = "round";
  for (let gy = 15; gy < H; gy += step) {
    for (let gx = 15; gx < W; gx += step) {
      let vx = Math.sin(gy * 0.0075 + f * 0.03) + 0.5 * Math.sin(gx * 0.021 - f * 0.02);
      let vy = Math.cos(gx * 0.0083 - f * 0.026) + 0.5 * Math.cos(gy * 0.017 + f * 0.018);
      const kd = Math.hypot(gx - s.kx, gy - s.ky);
      const kw = 2.4 / (1 + (kd / 170) ** 2);
      vx += (-(gy - s.ky) / (kd + 1)) * kw;
      vy += ((gx - s.kx) / (kd + 1)) * kw;
      let heat = kw * 0.2;
      if (pourAmt) {
        const t = clamp01((gy - s.tip.y) / (surf.cy - s.tip.y));
        const sx = lerp(s.tip.x, 548, t);
        const d = Math.abs(gx - sx);
        const w = (3.6 / (1 + (d / 90) ** 2)) * (gy > s.tip.y - 40 && gy < surf.cy + 30 ? 1 : 0);
        vy += w;
        vx += ((sx - gx) / (d + 1)) * w * 0.6;
        heat += w * 0.28;
      }
      const cd = Math.hypot(gx - 540, (gy - 930) * 0.8);
      const cw = (s.level * 2) / (1 + (cd / 230) ** 2);
      vx += (-(gy - 930) / (cd + 1)) * cw;
      vy += ((gx - 540) / (cd + 1)) * cw;
      heat += cw * 0.3;
      if (steamAmt > 0 && gy < 800 && gx > 340 && gx < 740) {
        const w = steamAmt * 3.2 * clamp01(1 - Math.abs(gx - 540) / 200);
        vy -= w;
        heat += w * 0.14;
      }
      const a = Math.atan2(vy, vx);
      const m = Math.min(1, Math.hypot(vx, vy) / 3.4);
      const L = 7 + 13 * m;
      const hue = 212 - heat * 170;
      c.strokeStyle = `hsla(${hue},95%,${52 + heat * 26}%,${0.48 + Math.min(0.5, heat * 0.5)})`;
      c.beginPath();
      c.moveTo(gx - Math.cos(a) * L, gy - Math.sin(a) * L);
      c.lineTo(gx + Math.cos(a) * L, gy + Math.sin(a) * L);
      c.stroke();
    }
  }

  // Kettle cloud: assembles from the field, bursts apart on exit.
  const a0 = (s.tilt * Math.PI) / 180;
  const ca = Math.cos(a0);
  const sa = Math.sin(a0);
  c.fillStyle = "#7fe9ff";
  c.globalAlpha = 0.75;
  for (const p of g.kettle) {
    const form = clamp01((f - p.a * 16) / 18);
    const e = form * form * (3 - 2 * form);
    const hx = s.kx + p.x * ca - p.y * sa;
    const hy = s.ky + p.x * sa + p.y * ca;
    const sx = p.b * W;
    const sy = p.c * H;
    let x = lerp(sx, hx, e) + Math.sin(f * 0.08 + p.a * 40) * 2.2;
    let y = lerp(sy, hy, e) + Math.cos(f * 0.07 + p.b * 40) * 2.2;
    const burst = clamp01(exit * 1.4 - p.a * 0.4);
    if (burst > 0) {
      x += Math.cos(p.b * 6.283) * burst * burst * 520;
      y += Math.sin(p.b * 6.283) * burst * burst * 520 - burst * 60;
    }
    if (burst >= 1) continue;
    c.fillRect(x, y, 2.6, 2.6);
  }

  // Cup: every point waits dim until the level climbs past it.
  for (const p of g.cup) {
    const h = clamp01((1078 - p.y) / 280);
    const lit = h < s.level * (0.97 + 0.08 * p.a) && s.level > 0;
    const jx = lit ? Math.sin(f * 0.18 + p.a * 30) * 3 : 0;
    const jy = lit ? Math.cos(f * 0.16 + p.b * 30) * 3 : 0;
    c.fillStyle = lit ? "#ffae3a" : "#a2492a";
    c.globalAlpha = lit ? 0.78 : 0.42;
    c.fillRect(p.x + jx, p.y + jy, 2.6, 2.6);
  }
  c.fillStyle = "#ffd9a0";
  c.globalAlpha = 0.85;
  for (const p of g.rim) c.fillRect(p.x, p.y, 2.6, 2.6);

  // Chai surface: concentric rings of points that ripple outward.
  if (s.level > 0) {
    c.fillStyle = "#ffcc6a";
    for (let ring = 1; ring <= 9; ring++) {
      const k = (ring / 9 + f * 0.012) % 1;
      const n = Math.floor(30 + 150 * k);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring;
        c.globalAlpha = 0.75 * (1 - k * 0.5);
        c.fillRect(surf.cx + Math.cos(a) * surf.rx * k, surf.cy + Math.sin(a) * surf.ry * k, 2.6, 2.6);
      }
    }
  }

  // Pour: a jet of particles, with short analytic trails.
  if (s.streaming) {
    const hd = interpolate(f, [42, 47], [0, 1], cl);
    const tl = interpolate(f, [96, 101], [0, 1], cl);
    const r = rng(8920);
    for (let i = 0; i < 850; i++) {
      const u = r();
      const v = r();
      const phase = (u + f * 0.05) % 1;
      if (phase > hd || phase < tl) continue;
      const tt = phase * phase * 0.4 + phase * 0.6;
      const spread = 7 + 30 * phase;
      const x = lerp(s.tip.x, 548, tt) + Math.sin(v * 80 + f * 0.25) * spread;
      const y = lerp(s.tip.y, surf.cy, tt);
      c.fillStyle = v > 0.7 ? "#fff0c0" : "#ff9c2e";
      c.globalAlpha = 0.7;
      c.fillRect(x, y, 2.8, 6 + 12 * phase);
    }
  }

  // Steam: three strands of drifting particles along the shared steam curve.
  const rs = rng(8930);
  c.fillStyle = "#e6eeff";
  s.steam.forEach((p, k) => {
    if (p <= 0) return;
    const count = Math.floor(620 * p);
    for (let i = 0; i < count; i++) {
      const u = rs();
      const v = rs();
      const t = ((u + f * 0.014) % 1) * p;
      const curl = Math.sin(v * 90 + f * 0.1) * (5 + 62 * t);
      const x = STEAM_X[k] + Math.sin(t * Math.PI * 2.6 + f * 0.05 + k * 1.7) * (16 + 34 * t) + curl;
      const y = 770 - 370 * t;
      c.globalAlpha = 0.72 * (1 - t * 0.6);
      c.fillRect(x, y, 2.6, 2.6);
    }
  });
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
};

export const Generative: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  return (
    <AbsoluteFill style={{ background: "#04050b" }}>
      <Raster frame={f} width={W} height={H} paint={(c) => generate(c, s, f)} />
    </AbsoluteFill>
  );
};
