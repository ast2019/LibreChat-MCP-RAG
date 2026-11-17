import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import {
    POLY, Pt, clampToRim, clampX, ellipsePts,
    lineD,
    pathPts,
    pourPts, rng, sample, scan, segD, wobble, zigPts
} from "./core";

const round = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* ---------- 02 Chalkboard: chalk sticks on a slate board, dust hanging off every line ---------- */
const CK_BODY = segD(scan(POLY.body, 15, 66));
const CK_KETTLE = segD(scan(POLY.kBody, 17, 74));
const CK_LID = segD(scan(POLY.lid, 9, 20));
const CK_SPOUT = segD(scan(POLY.spout, 9, 30));
const CK_SMEARS = [
  "M90,240 C300,120 620,150 960,260", "M60,520 C340,430 700,470 1020,600", "M80,1000 C380,900 720,1010 1010,930",
  "M120,760 C260,690 340,720 450,650", "M640,180 C760,120 900,160 1000,120",
];
export const Chalkboard: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const k = (sf / 2) % 5;
  const white = "#f6f2e6";
  const chai = sf > 43 ? segD(scan(clampToRim(ellipsePts(s.surface.cx, s.surface.cy, s.surface.rx, s.surface.ry)), 10, 8)) : "";
  const rd = new Array(26).fill(0).map((_, i) => {
    const r = rng(i + 3);
    const x = 70 + r() * 940;
    const sp = 0.5 + r() * 1.3;
    const y = (120 + r() * 1100 + sf * sp) % 1180;
    return <circle key={i} cx={x + Math.sin(sf * 0.05 + i) * 8} cy={40 + y} r={1 + r() * 2} fill={white} opacity={0.18 + r() * 0.3} />;
  });
  const stick = (x: number, y: number, c: string, r: number) => (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x={-58} y={-10} width={116} height={20} rx={9} fill={c} />
      <rect x={-58} y={-10} width={116} height={7} rx={4} fill="#fff" opacity={0.35} />
    </g>
  );
  return (
    <Stage bg="#1b2925" defs={
      <>
        <filter id="ck-smudge" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.005 0.012" numOctaves={4} seed={21} />
          <feColorMatrix values="0 0 0 0 0.82  0 0 0 0 0.88  0 0 0 0 0.84  1.5 0 0 0 -0.62" />
        </filter>
        <filter id="ck-blur" {...region}><feGaussianBlur stdDeviation={26} /></filter>
        <filter id="ck-line" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves={3} seed={3 + k} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  7 0 0 0 -2.7" result="m" />
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} seed={11 + k} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={6} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feComposite in="d" in2="m" operator="in" result="c" />
          <feGaussianBlur in="d" stdDeviation={8} result="b" />
          <feComponentTransfer in="b" result="dust"><feFuncA type="linear" slope={0.42} /></feComponentTransfer>
          <feMerge><feMergeNode in="dust" /><feMergeNode in="c" /></feMerge>
        </filter>
        <filter id="ck-side" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.3 0.42" numOctaves={3} seed={30 + k} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 0 0 0 -3.6" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" result="c" />
          <feGaussianBlur in="SourceGraphic" stdDeviation={12} result="b" />
          <feComponentTransfer in="b" result="dust"><feFuncA type="linear" slope={0.24} /></feComponentTransfer>
          <feMerge><feMergeNode in="dust" /><feMergeNode in="c" /></feMerge>
        </filter>
        <clipPath id="ck-rim"><path d={P.rim} /></clipPath>
        <radialGradient id="ck-vig" cx="50%" cy="46%" r="72%">
          <stop offset="55%" stopColor="#000" stopOpacity={0} /><stop offset="100%" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <linearGradient id="ck-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a5a33" /><stop offset="1" stopColor="#4e2f18" /></linearGradient>
      </>
    }>
      <rect width={W} height={H} filter="url(#ck-smudge)" opacity={0.13} />
      <g filter="url(#ck-blur)" opacity={0.09}>
        {CK_SMEARS.map((d, i) => <path key={i} d={d} stroke="#dfe8e0" strokeWidth={120} {...round} />)}
      </g>
      <g filter="url(#ck-side)">
        <path d="M70,1082 Q540,1064 1010,1086" stroke="#dfe6c4" strokeWidth={15} {...round} opacity={0.7} /><path d="M280,1108 L840,1100" stroke="#dfe6c4" strokeWidth={26} {...round} opacity={0.32} />
        <path d={CK_BODY} stroke="#ef8a58" strokeWidth={10} {...round} />
        {chai ? <g clipPath="url(#ck-rim)"><path d={chai} stroke="#f4c04e" strokeWidth={13} {...round} /></g> : null}
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={CK_KETTLE} stroke="#7cc6e2" strokeWidth={11} {...round} />
          <path d={CK_LID} stroke="#f2a7b8" strokeWidth={10} {...round} />
          <path d={CK_SPOUT} stroke="#77bcd6" strokeWidth={10} {...round} />
        </g>
      </g>
      <g filter="url(#ck-line)">
        <path d={P.kulhadOutline} stroke={white} strokeWidth={10} {...round} />
        <path d={P.rim} stroke={white} strokeWidth={9} {...round} />
        {s.streaming ? (
          <>
            <path d={s.stream} stroke="#f4c04e" strokeWidth={22} {...round} />
            <path d={s.stream} stroke={white} strokeWidth={4} {...round} transform="translate(9 0)" />
          </>
        ) : null}
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={P.kettleBody} stroke={white} strokeWidth={10} {...round} />
          <path d={P.kettleLid} stroke={white} strokeWidth={8} {...round} />
          <path d={P.kettleSpout} stroke={white} strokeWidth={9} {...round} />
          <path d={P.kettleHandle} stroke={white} strokeWidth={13} {...round} />
          <path d={P.kettleBand} stroke="#f4c04e" strokeWidth={9} {...round} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} stroke={white} strokeWidth={8} fill="none" />
        </g>
        {s.steam.map((p, i) => (p > 0 ? <path key={i} d={steamPath(i, p, sf * 0.05)} stroke={white} strokeWidth={8} {...round} opacity={0.92} /> : null))}
      </g>
      {rd}
      <rect width={W} height={H} fill="url(#ck-vig)" />
      <path fillRule="evenodd" d={`M0,0H${W}V${H}H0Z M46,46H${W - 46}V1236H46Z`} fill="url(#ck-wood)" />
      <rect x={46} y={1236} width={W - 92} height={16} fill="#2a1a0d" opacity={0.75} />
      <rect x={20} y={1262} width={W - 40} height={46} rx={8} fill="#6b4324" />
      <rect x={20} y={1262} width={W - 40} height={8} fill="#a97a4c" />
      {stick(330, 1260, "#f6f2e6", 2)}
      {stick(500, 1262, "#e8875a", -3)}
      {stick(680, 1260, "#77bcd6", 4)}
      <rect x={812} y={1214} width={150} height={52} rx={8} fill="#2c2c30" />
      <rect x={812} y={1248} width={150} height={18} rx={4} fill="#d8d3c5" opacity={0.75} />
    </Stage>
  );
};

/* ---------- 05 Notepad doodle: bored-in-class ballpoint, retraced lines and scribbled shading ---------- */
const PG = (pts: Pt[], seed: number, passes: number, amp: number, wave = 11) => {
  let d = "";
  for (let i = 0; i < passes; i++) d += lineD(wobble(pts, seed + i * 7, amp, wave));
  return d;
};
const star = (cx: number, cy: number, r: number): Pt[] =>
  [0, 2, 4, 1, 3, 0].map((k) => ({ x: cx + Math.sin((k * 2 * Math.PI) / 5) * r, y: cy - Math.cos((k * 2 * Math.PI) / 5) * r }));
const spiral = (cx: number, cy: number, r: number, turns: number): Pt[] =>
  new Array(90).fill(0).map((_, i) => {
    const t = i / 89;
    const a = t * turns * Math.PI * 2;
    return { x: cx + Math.cos(a) * r * t, y: cy + Math.sin(a) * r * t };
  });
const NP_MARGIN = [
  PG(star(258, 300, 62), 3, 2, 2),
  PG(spiral(420, 306, 58, 4), 5, 1, 1.4),
  PG([{ x: 180, y: 1228 }, { x: 330, y: 1212 }, { x: 310, y: 1192 }, { x: 330, y: 1212 }, { x: 312, y: 1236 }], 9, 2, 2),
  PG(star(940, 1238, 42), 6, 2, 2),
  PG([{ x: 560, y: 1190 }, { x: 512, y: 1262 }, { x: 556, y: 1254 }, { x: 524, y: 1322 }, { x: 610, y: 1236 }, { x: 568, y: 1244 }, { x: 610, y: 1190 }, { x: 560, y: 1190 }], 14, 2, 1.5),
  PG(ellipsePts(740, 1250, 50, 50), 21, 3, 3),
  PG([{ x: 180, y: 1040 }, { x: 260, y: 1040 }, { x: 260, y: 1120 }, { x: 180, y: 1120 }, { x: 180, y: 1040 }, { x: 216, y: 1006 }, { x: 296, y: 1006 }, { x: 260, y: 1040 }, { x: 296, y: 1006 }, { x: 296, y: 1086 }, { x: 260, y: 1120 }], 31, 2, 1.6),
  PG(spiral(238, 620, 44, 3), 33, 1, 1.2),
  PG(ellipsePts(240, 880, 42, 24), 35, 2, 2),
  PG(ellipsePts(240, 880, 12, 12), 36, 3, 1.4),
  PG([{ x: 860, y: 1000 }, { x: 880, y: 960 }, { x: 900, y: 1000 }, { x: 920, y: 960 }, { x: 940, y: 1000 }, { x: 960, y: 960 }, { x: 980, y: 1000 }], 38, 2, 2),
  PG([{ x: 716, y: 1240 }, { x: 728, y: 1240 }, { x: 752, y: 1240 }, { x: 764, y: 1240 }], 22, 1, 1),
  PG([{ x: 720, y: 1272 }, { x: 740, y: 1284 }, { x: 760, y: 1272 }], 23, 1, 1),
].join("");
const NP_RULES = new Array(21).fill(0).map((_, i) => 180 + i * 56);
export const Notepad: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const b = sf / 3;
  const se = (b % 4) + 1;
  const bodyScrib = zigPts(scan(POLY.body, 15, 58));
  const bodyCross = zigPts(scan(POLY.body, 14, -40).filter(([a, c]) => (a.x + c.x) / 2 > 575));
  const kShade = zigPts(scan(POLY.kBody, 13, 64).filter(([a, c]) => (a.x + c.x) / 2 > 35));
  const local = (d: string, sd: number, passes: number, amp: number) => PG(sample(d, 7), sd, passes, amp);
  let blue = "";
  blue += PG(POLY.kulhadLine, se, 3, 3.6) + PG(sample(P.rim, 7), se + 2, 3, 3.2);
  blue += PG(bodyScrib, se + 3, 1, 6, 2) + PG(bodyCross, se + 40, 1, 5, 2);
  const k1 = local(P.kettleBody, se + 4, 3, 3.6) + local(P.kettleLid, se + 5, 3, 2.6) + local(P.kettleSpout, se + 6, 3, 2.8) + local(P.kettleHandle, se + 8, 4, 4.5) + local(P.kettleBand, se + 9, 2, 2.2) + PG(ellipsePts(KNOB.x, KNOB.y, KNOB.r, KNOB.r, 22), se + 10, 3, 2.2) + PG(kShade, se + 11, 1, 2.6, 3);
  blue += s.steam
    .map((p, i) => {
      if (p <= 0) return "";
      const ps = pathPts(steamPath(i, p, sf * 0.04));
      const out: Pt[] = [];
      ps.forEach((q, j) => {
        for (let m = 0; m < 4; m++) {
          const a = (j + m / 4) * 0.62 + sf * 0.12;
          out.push({ x: q.x + Math.cos(a) * 12, y: q.y + Math.sin(a) * 8 });
        }
      });
      return PG(out, se + 12 + i, 1, 1.5, 7);
    })
    .join("");
  let red = "";
  if (s.level > 0) red += PG(zigPts(scan(clampToRim(ellipsePts(s.surface.cx, s.surface.cy, s.surface.rx, s.surface.ry)), 5.5, 7)), se + 20, 2, 2.2, 4);
  if (s.streaming) {
    const ps = pourPts(sf, s.tip, { x: 548, y: s.surface.cy }, 40);
    for (let i = -3; i <= 3; i++) red += lineD(wobble(ps.map((p) => ({ x: p.x + i * 3.6, y: p.y })), se + 30 + i, 3, 4));
  }
  return (
    <Stage bg="#fbf9f0" defs={
      <>
        <filter id="np-g" {...region}><feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={4} /><feColorMatrix values="0 0 0 0 0.4  0 0 0 0 0.4  0 0 0 0 0.35  0.5 0 0 0 -0.2" /></filter>
        <linearGradient id="np-ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6b6f78" /><stop offset="0.5" stopColor="#eef0f4" /><stop offset="1" stopColor="#6b6f78" /></linearGradient>
      </>
    }>
      {NP_RULES.map((y) => <line key={y} x1={0} x2={W} y1={y} y2={y} stroke="#9fc0e6" strokeWidth={2.6} />)}
      <line x1={126} x2={126} y1={0} y2={H} stroke="#e77b82" strokeWidth={3} />
      <line x1={136} x2={136} y1={0} y2={H} stroke="#e77b82" strokeWidth={1.6} opacity={0.7} />
            <rect width={W} height={H} filter="url(#np-g)" opacity={0.4} />
      <rect width={W} height={94} fill="#d7d3c5" />
      <rect y={88} width={W} height={8} fill="#000" opacity={0.18} />
      {new Array(11).fill(0).map((_, i) => (
        <g key={i} transform={`translate(${70 + i * 94} 0)`}>
          <ellipse cx={0} cy={118} rx={16} ry={13} fill="#3a3a3f" />
          <rect x={-8} y={18} width={16} height={100} rx={8} fill="url(#np-ring)" />
        </g>
      ))}
      <path d={NP_MARGIN} stroke="#2243b8" strokeWidth={3.4} {...round} opacity={0.82} />
      <path d={blue} stroke="#2243b8" strokeWidth={4.2} {...round} opacity={0.9} />
      <path d={red} stroke="#cf2438" strokeWidth={3.6} {...round} opacity={0.92} />
      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d={P.kettleBody} fill="#fbf9f0" opacity={0.86} />
        <path d={P.kettleSpout} fill="#fbf9f0" opacity={0.86} />
        <path d={k1} stroke="#2243b8" strokeWidth={4.2} {...round} opacity={0.9} />
      </g>
    </Stage>
  );
};

/* ---------- 06 Blueprint: orthographic section drawing, the cup cut open, live dimensions ---------- */
const BP = "#eef6ff";
const WALL = "M370,800 L425,1040 Q540,1076 655,1040 L710,800 L680,800 L632,1015 Q540,1044 448,1015 L400,800 Z";
const CAVITY = "M400,800 L448,1015 Q540,1044 632,1015 L680,800 Z";
const BP_HATCH = segD(scan(sample(WALL, 5), 12, 45));
const head = (x: number, y: number, a: number, s = 20) => {
  const c = Math.cos(a);
  const n = Math.sin(a);
  return `M${x},${y}L${x - c * s - n * s * 0.28},${y - n * s + c * s * 0.28}L${x - c * s + n * s * 0.28},${y - n * s - c * s * 0.28}Z`;
};
const Dim: React.FC<{ a: Pt; b: Pt; o?: number }> = ({ a, b, o = 1 }) => {
  const an = Math.atan2(b.y - a.y, b.x - a.x);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = { x: -Math.sin(an), y: Math.cos(an) };
  const bars = [-16, -8, 0, 8, 16].map((t) => {
    const c = { x: m.x + Math.cos(an) * t, y: m.y + Math.sin(an) * t };
    return `M${c.x + n.x * 9},${c.y + n.y * 9}L${c.x - n.x * 9},${c.y - n.y * 9}`;
  }).join("");
  return (
    <g opacity={o}>
      <path d={`M${a.x},${a.y}L${b.x},${b.y}`} stroke={BP} strokeWidth={2} fill="none" />
      <path d={head(a.x, a.y, an + Math.PI) + head(b.x, b.y, an)} fill={BP} />
      <rect x={m.x - 24} y={m.y - 12} width={48} height={24} fill="#123f7f" transform={`rotate(${(an * 180) / Math.PI} ${m.x} ${m.y})`} />
      <path d={bars} stroke={BP} strokeWidth={2} fill="none" />
    </g>
  );
};
export const Blueprint: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const floor = 1030;
  const y = floor - s.level * 208;
  const a = (s.tilt * Math.PI) / 180;
  const R = 266;
  const arc: Pt[] = new Array(25).fill(0).map((_, i) => {
    const t = (a * i) / 24 - Math.PI / 2;
    return { x: s.kx + Math.cos(t) * R, y: s.ky + Math.sin(t) * R };
  });
  const pour = lineD(pourPts(f, s.tip, { x: 548, y }, 24));
  const rows = s.level > 0 ? segD(scan([{ x: 380, y }, { x: 700, y }, { x: 700, y: 1060 }, { x: 380, y: 1060 }], 9, 0)) : "";
  const thin = { stroke: BP, strokeWidth: 2, fill: "none" } as const;
  const obj = { stroke: BP, strokeWidth: 5, fill: "none", strokeLinejoin: "miter" } as const;
  const ax = "48 12 6 12";
  return (
    <Stage bg="#123f7f" defs={
      <>
        <pattern id="bp-g" width={30} height={30} patternUnits="userSpaceOnUse"><path d="M30,0H0V30" fill="none" stroke="#bcd8ff" strokeWidth={1} opacity={0.28} /></pattern>
        <pattern id="bp-G" width={150} height={150} patternUnits="userSpaceOnUse"><path d="M150,0H0V150" fill="none" stroke="#d6e7ff" strokeWidth={2} opacity={0.34} /></pattern>
        <filter id="bp-m" {...region}><feTurbulence type="fractalNoise" baseFrequency="0.004 0.009" numOctaves={4} seed={6} /><feColorMatrix values="0 0 0 0 0.02  0 0 0 0 0.09  0 0 0 0 0.3  2.2 0 0 0 -0.85" /></filter>
        <filter id="bp-c" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={5} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5 0 0 0 -1.2" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <clipPath id="bp-cav"><path d={CAVITY} /></clipPath>
      </>
    }>
      <rect width={W} height={H} fill="url(#bp-g)" />
      <rect width={W} height={H} fill="url(#bp-G)" />
      <rect width={W} height={H} filter="url(#bp-m)" opacity={0.6} />
      <g filter="url(#bp-c)">
        <rect x={34} y={34} width={W - 68} height={H - 68} {...thin} strokeWidth={4} />
        <rect x={50} y={50} width={W - 100} height={H - 100} {...thin} />
        {new Array(7).fill(0).map((_, i) => <path key={i} d={`M${34 + ((W - 68) * i) / 6},34v16M${34 + ((W - 68) * i) / 6},${H - 50}v16`} {...thin} />)}
        <path d={`M540,250V1188`} {...thin} strokeDasharray={ax} />
        <path d="M250,800H830" {...thin} strokeDasharray={ax} opacity={0.55} />
        <path d="M250,1106H830" {...thin} opacity={0.5} />
        <path d={WALL} {...obj} />
        <path d={BP_HATCH} {...thin} clipPath="url(#bp-wall)" />
        <clipPath id="bp-wall"><path d={WALL} /></clipPath>
        {rows ? <g clipPath="url(#bp-cav)"><path d={rows} {...thin} strokeWidth={3} /></g> : null}
        {s.level > 0 ? (
          <g clipPath="url(#bp-cav)"><path d={`M380,${y}H700`} {...thin} strokeWidth={6} /></g>
        ) : null}
        {s.level > 0 ? <path d={`M612,${y - 3}l-13,-22h26zM598,${y + 11}h28M604,${y + 21}h16`} {...thin} strokeWidth={2.4} /> : null}
        {s.streaming ? (
          <>
            <path d={pour} stroke={BP} strokeWidth={22} fill="none" strokeLinecap="butt" />
            <path d={pour} stroke="#123f7f" strokeWidth={14} fill="none" strokeLinecap="butt" />
            <path d={pour} stroke={BP} strokeWidth={3} fill="none" strokeDasharray="14 12" strokeDashoffset={-f * 4} />
          </>
        ) : null}
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d="M0,-210V190" {...thin} strokeDasharray={ax} />
          <path d="M-205,35H205" {...thin} strokeDasharray={ax} opacity={0.6} />
          <path d={P.kettleBody} {...obj} />
          <path d={P.kettleLid} {...obj} strokeWidth={4} />
          <path d={P.kettleSpout} {...obj} strokeWidth={4} />
          <path d={P.kettleHandle} {...obj} />
          <path d="M140,-24 C222,-46 222,76 140,74" {...thin} strokeDasharray="10 7" />
          <path d={P.kettleBand} {...thin} strokeWidth={3} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} {...obj} strokeWidth={4} />
          <path d="M-118,-50 C-150,40 -135,118 -82,124 L82,124 C135,118 150,40 118,-50" {...thin} strokeDasharray="10 7" />
          <path d="M-6,6L6,-6M-6,-6L6,6" {...thin} strokeWidth={3} />
        </g>
        {Math.abs(s.tilt) > 1.5 ? (
          <g>
            <path d={lineD(arc)} {...thin} strokeWidth={2.6} />
            <path d={`M${s.kx},${s.ky}V${s.ky - R - 26}`} {...thin} opacity={0.7} />
            <path d={head(arc[24].x, arc[24].y, a - Math.PI)} fill={BP} />
          </g>
        ) : null}
        {s.tilt < -30 ? (
          <g><circle cx={s.tip.x} cy={s.tip.y} r={26} {...thin} /><path d={`M${s.tip.x - 40},${s.tip.y}h80M${s.tip.x},${s.tip.y - 40}v80`} {...thin} /></g>
        ) : null}
        <path d="M425,1060V1150M655,1060V1150" {...thin} />
        <Dim a={{ x: 425, y: 1140 }} b={{ x: 655, y: 1140 }} />
        <path d="M360,800H270M415,1040H270" {...thin} />
        <Dim a={{ x: 286, y: 800 }} b={{ x: 286, y: 1040 }} />
        <path d="M690,1030H840" {...thin} />
        {s.level > 0.02 ? (
          <>
            <path d={`M640,${y}H840`} {...thin} />
            <Dim a={{ x: 824, y: floor }} b={{ x: 824, y }} o={interpolate(s.level, [0.02, 0.12], [0, 1], clampX)} />
          </>
        ) : null}
        <path d="M300,1190l-14,28h28z M780,1190l-14,28h28z" fill={BP} opacity={0.85} />
        <path d="M300,1190H500M580,1190H780" {...thin} strokeDasharray="30 10" opacity={0.75} />
        {s.steam.map((p, i) => {
          if (p <= 0.1) return null;
          const ps = pathPts(steamPath(i, p, f * 0.05));
          const e = ps[ps.length - 1];
          const q = ps[ps.length - 3];
          return (
            <g key={i}>
              <path d={lineD(ps)} {...thin} strokeWidth={3.4} strokeDasharray="16 10" />
              <path d={head(e.x, e.y, Math.atan2(e.y - q.y, e.x - q.x), 24)} fill={BP} />
            </g>
          );
        })}
        <g>
          <rect x={688} y={1192} width={342} height={108} {...thin} strokeWidth={3.4} />
          <path d="M688,1228H1030M688,1264H1030M820,1192V1300M930,1228V1300" {...thin} />
          <path d="M704,1204h88M704,1216h60M836,1210h170M704,1246h100M836,1246h76M946,1246h66M704,1282h60M836,1282h40M946,1282h50" {...thin} strokeWidth={5} opacity={0.8} />
        </g>
      </g>
    </Stage>
  );
};

