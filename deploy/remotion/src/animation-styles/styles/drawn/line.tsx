import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Rough, Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { Pt, brush, clampToRim, clampX, lerp, lineD, noise1, pathPts, place, rng, sample, segD, wobble } from "./core";

const round = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* ---------- 13 One line: cup, chai, steam and kettle are all one unbroken line, nothing else on the page ---------- */
const CUP_ROUTE = sample("M-30,1120 C130,1136 280,1040 370,800 A170,42 0 0,1 710,800 L655,1040 Q540,1076 425,1040 L370,800 A170,42 0 0,0 710,800", 5);
const KETTLE_ROUTE = sample(
  "M-251,-62 L-240,-77 C-206,-56 -170,-42 -130,-42 L-130,-70 L-92,-86 Q-46,-119 0,-119 A17,17 0 1,1 0.5,-119 Q46,-119 92,-86 Q0,-108 -92,-86 L-130,-70 Q0,-102 130,-70 L140,-42 C256,-74 256,94 140,92 C154,50 150,10 140,-42 C150,10 154,50 140,92 C136,120 118,136 90,140 L-90,140 C-135,135 -155,85 -146,34 C-200,12 -226,-30 -263,-50 L-251,-62",
  5,
);
export const OneLine: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const a = interpolate(f, [40, 48], [0, 1], clampX);
  const w = interpolate(f, [40, 48, 95, 102], [0, 1, 1, 0], clampX);
  const R = { x: 710, y: 800 };
  const C = { x: lerp(R.x, 548, a), y: lerp(R.y, s.surface.cy, a) };
  const pts: Pt[] = [...CUP_ROUTE];
  if (a > 0) {
    const sc = 0.15 + 0.85 * s.level;
    const sp: Pt[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const an = t * Math.PI * 2 * 2.6;
      const r = (1 - t * 0.9) * sc;
      sp.push({ x: s.surface.cx + Math.cos(an) * s.surface.rx * r, y: s.surface.cy + Math.sin(an) * s.surface.ry * r });
    }
    pts.push(...clampToRim(sp, 0.95).map((q) => ({ x: lerp(C.x, q.x, a), y: lerp(C.y, q.y, a) })));
  }
  let last = pts[pts.length - 1];
  s.steam.forEach((p, i) => {
    if (p <= 0) return;
    const k = Math.min(1, p * 8);
    const up = pathPts(steamPath(i, p, f * 0.05)).map((q) => ({ x: lerp(last.x, q.x, k), y: lerp(last.y, q.y, k) }));
    pts.push(...up, ...[...up].reverse());
  });
  last = pts[pts.length - 1];
  const K = place(KETTLE_ROUTE, s.kx, s.ky, s.tilt);
  const tip = K[0];
  const n = 120;
  const mid = { x: (last.x + tip.x) / 2, y: (last.y + tip.y) / 2 };
  const ctrl = { x: lerp(Math.max(last.x + 300, mid.x + 40), mid.x - 8, w), y: lerp(last.y + 26, mid.y, w) };
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * last.x + 2 * u * t * ctrl.x + t * t * tip.x;
    const y = u * u * last.y + 2 * u * t * ctrl.y + t * t * tip.y;
    const env = Math.sin(t * Math.PI) ** 0.4;
    pts.push({ x: x + Math.sin(t * 74 - f * 0.9) * 22 * w * env, y });
  }
  pts.push(...K);
  const rev = interpolate(f, [0, 22], [0.24, 1], clampX);
  const shown = pts.slice(0, Math.max(2, Math.floor(pts.length * rev)));
  const end = shown[shown.length - 1];
  return (
    <Stage bg="#e64a2e" defs={
      <filter id="ol-g" {...region}><feTurbulence type="fractalNoise" baseFrequency={0.7} numOctaves={2} seed={3} /><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.08  0 0 0 0 0.02  0.7 0 0 0 -0.26" /></filter>
    }>
      <rect width={W} height={H} filter="url(#ol-g)" opacity={0.6} />
      <path d={lineD(shown)} stroke="#fff4dd" strokeWidth={10} {...round} />
      {rev < 1 ? <circle cx={end.x} cy={end.y} r={13} fill="#fff4dd" /> : null}
    </Stage>
  );
};

/* ---------- 16 Cel with line boil: inked and painted cels over a static gouache background ---------- */
const ink = (d: string, w: number, se: number, step = 5) => {
  const pts = sample(d, step);
  return brush(wobble(pts, se, 1.1, 6), (t, i) => w * (0.38 + 0.62 * Math.sin(Math.PI * t) ** 0.7) * (1 + 0.3 * noise1(i / 5, se + 3)));
};
const CEL_INK = [1, 2, 3, 4].map((se) => ({
  body: ink(P.kettleBody, 13, se * 3 + 1),
  lid: ink(P.kettleLid, 9, se * 3 + 2),
  spout: ink(P.kettleSpout, 10, se * 3 + 3),
  handleA: ink("M140,-58 C276,-92 276,112 140,108", 11, se * 3 + 4),
  handleB: ink("M140,-26 C232,-54 232,78 140,76", 9, se * 3 + 5),
  band: ink(P.kettleBand, 8, se * 3 + 6),
  cup: ink(P.kulhadOutline, 15, se * 3 + 7),
  rim: ink(P.rim, 11, se * 3 + 8),
}));
export const CelBoil: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const se = (sf / 2) % 4;
  const L = CEL_INK[se];
  const settle = interpolate(f, [22, 26, 32, 38], [0, 1, -0.5, 0], clampX);
  const out = interpolate(f, [100, 108], [0, 1], { ...clampX, easing: Easing.in(Easing.quad) });
  const sx = 1 + settle * 0.06 - out * 0.06;
  const sy = 1 - settle * 0.08 + out * 0.04;
  const K = `translate(${s.kx} ${s.ky + settle * 6}) rotate(${s.tilt}) scale(${sx} ${sy})`;
  const line = "#14121a";
  const surfEl = <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} />;
  const puffs = s.steam.map((p, i) => {
    if (p <= 0) return null;
    const pts = pathPts(steamPath(i, p, sf * 0.05));
    const d = brush(pts, (t) => (10 + 48 * Math.sin(Math.PI * t) ** 0.8) * (1 + 0.1 * Math.sin(t * 12 + sf * 0.3)));
    return <path key={i} d={d} fill="#fbfbf2" stroke={line} strokeWidth={5.5} strokeLinejoin="round" />;
  });
  const mark = (x: number, y: number) => <g><circle cx={x} cy={y} r={2.5} fill="#3b2a1c" opacity={0.28} /></g>;
  const dust = new Array(5).fill(0).map((_, i) => {
    const r = rng(i * 13 + Math.floor(f / 2));
    return <g key={i}>{mark(r() * W, r() * H)}</g>;
  });
  return (
    <Stage bg="#6fa49b" defs={
      <>
        <Rough id="cb-l" seed={se + 1} freq={0.045} scale={5} />
        <filter id="cb-bg" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves={3} seed={11} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={14} result="d" />
          <feGaussianBlur in="d" stdDeviation={1.2} />
        </filter>
        <filter id="cb-b" {...region}><feTurbulence type="fractalNoise" baseFrequency="0.006 0.02" numOctaves={5} seed={6} /><feColorMatrix values="0 0 0 0 0.98  0 0 0 0 0.92  0 0 0 0 0.75  2.2 0 0 0 -0.95" /></filter>
        <clipPath id="cb-rim"><path d={P.rim} /></clipPath>
        <clipPath id="cb-cup"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="cb-k"><path d={P.kettleBody} /></clipPath>
      </>
    }>
      <g filter="url(#cb-bg)">
        <rect width={W} height={H} fill="#5f9c97" />
        <rect x={120} y={110} width={420} height={500} fill="#f3d796" />
        <rect x={140} y={130} width={180} height={220} fill="#a5d3d6" />
        <rect x={340} y={130} width={180} height={220} fill="#a5d3d6" />
        <rect x={140} y={370} width={180} height={220} fill="#bfdfdd" />
        <rect x={340} y={370} width={180} height={220} fill="#bfdfdd" />
        <path d="M70,80 C160,260 150,520 90,650 L40,650 L40,80 Z" fill="#c8574a" />
        <path d="M590,80 C490,260 510,520 570,650 L620,650 L620,80 Z" fill="#c8574a" />
        <rect y={960} width={W} height={400} fill="#a9713f" />
        <rect y={960} width={W} height={46} fill="#c9925c" />
      </g>
      <rect width={W} height={H} filter="url(#cb-b)" opacity={0.3} />
      <ellipse cx={560} cy={1078} rx={250} ry={28} fill="#3f2a18" opacity={0.42} />
      <g transform="translate(9 11)" opacity={0.26}>
        <path d={P.kulhadBody} fill="#100d14" />
        <path d={P.kettleBody} transform={K} fill="#100d14" />
      </g>
      <path d={P.kulhadBody} fill="#e8743c" />
      <g clipPath="url(#cb-cup)">
        <path d="M625,780 C640,880 610,1000 560,1076 L740,1076 L740,780 Z" fill="#b24a24" />
        <path d="M410,850 C418,920 436,980 452,1020 L470,1024 C450,970 432,910 428,855 Z" fill="#ffd2a8" />
      </g>
      <path d={P.rim} fill="#6a2c12" />
      <g clipPath="url(#cb-rim)">
        {s.level > 0 ? <g fill="#b86f22">{surfEl}</g> : null}
        {s.level > 0 ? <ellipse cx={s.surface.cx - 46} cy={s.surface.cy - 6} rx={s.surface.rx * 0.42} ry={s.surface.ry * 0.3} fill="#f3cf8a" /> : null}
      </g>
      {s.streaming ? <path d={s.stream} stroke={line} strokeWidth={36} {...round} /> : null}
      {s.streaming ? <path d={s.stream} stroke="#b86f22" strokeWidth={26} {...round} /> : null}
      {s.streaming ? <path d={s.stream} stroke="#f3cf8a" strokeWidth={5} {...round} transform="translate(-5 0)" /> : null}
      <g transform={K}>
        <path d="M140,-42 C256,-74 256,94 140,92" stroke="#2a2730" strokeWidth={24} {...round} />
        <path d={P.kettleSpout} fill="#d8342b" />
        <path d={P.kettleBody} fill="#d8342b" />
        <g clipPath="url(#cb-k)">
          <path d="M60,-110 C130,-40 120,90 40,150 L200,150 L200,-110 Z" fill="#9c1f26" />
          <path d="M-112,-40 C-126,10 -122,60 -104,92 L-84,88 C-100,50 -102,0 -90,-38 Z" fill="#ffd9cc" />
        </g>
        <path d={P.kettleBand} stroke="#ffc83c" strokeWidth={14} fill="none" clipPath="url(#cb-k)" />
        <path d={P.kettleLid} fill="#3a2f60" />
        <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="#ffc83c" />
      </g>
      <g filter="url(#cb-l)" fill={line}>
        <path d={L.cup} />
        <path d={L.rim} />
        {s.level > 0 ? <g clipPath="url(#cb-rim)"><ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="none" stroke={line} strokeWidth={4.5} /></g> : null}
        <g transform={K}>
          <path d={L.body} /><path d={L.lid} /><path d={L.spout} /><path d={L.handleA} /><path d={L.handleB} /><path d={L.band} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="none" stroke={line} strokeWidth={6} />
        </g>
      </g>
      <g filter="url(#cb-l)">{puffs}</g>
      {dust}
    </Stage>
  );
};
void segD;
