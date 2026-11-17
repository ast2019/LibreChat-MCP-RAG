import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import {
    POLY, Pt, clampToRim, ellipsePts,
    lineD, mix,
    pathPts,
    rng, sample, scan, segD, wobble, zigPts
} from "./core";

const round = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const WK = `translate(0 0)`;

/* ---------- 09 Urban sketch: fineliner on a sketchbook page, wash dropped in fast and off-register ---------- */
const facet = (pts: Pt[], every: number, seed: number, amp: number): Pt[] => {
  const out: Pt[] = [];
  const r = rng(seed);
  for (let i = 0; i < pts.length; i += every) out.push({ x: pts[i].x + (r() - 0.5) * amp, y: pts[i].y + (r() - 0.5) * amp });
  out.push(pts[pts.length - 1]);
  return out;
};
// Straight-ish ink lines that overshoot their corners and sometimes skip.
const sk = (pts: Pt[], seed: number) => {
  const r = rng(seed);
  let d = "";
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const over = 0.04 + r() * 0.1;
    const skip = r() > 0.92;
    const j = () => (r() - 0.5) * 3.5;
    const bow = (r() - 0.5) * 0.05;
    const mx = (a.x + b.x) / 2 - dy * bow;
    const my = (a.y + b.y) / 2 + dx * bow;
    if (!skip) d += `M${(a.x - dx * over + j()).toFixed(1)},${(a.y - dy * over + j()).toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${(b.x + dx * over + j()).toFixed(1)},${(b.y + dy * over + j()).toFixed(1)}`;
  }
  return d;
};
const p = (x: number, y: number): Pt => ({ x, y });
const US_SCENE = [
  sk([p(70, 300), p(760, 196), p(830, 372), p(50, 448), p(70, 300)], 1),
  sk([p(150, 288), p(136, 438)], 2), sk([p(240, 276), p(232, 430)], 3), sk([p(330, 262), p(330, 420)], 4), sk([p(420, 250), p(428, 410)], 5), sk([p(510, 236), p(526, 402)], 6), sk([p(600, 222), p(622, 392)], 7), sk([p(690, 208), p(720, 382)], 8),
  sk([p(120, 442), p(112, 1010)], 9), sk([p(142, 440), p(136, 1010)], 10), sk([p(760, 378), p(776, 960)], 11),
  sk([p(860, 140), p(866, 620), p(1030, 660)], 12), sk([p(860, 300), p(1030, 330)], 13), sk([p(860, 440), p(1030, 470)], 14), sk([p(900, 180), p(960, 188), p(960, 280), p(902, 270), p(900, 180)], 15),
  sk([p(160, 560), p(740, 540)], 16), sk([p(160, 712), p(742, 690)], 17), sk([p(158, 860), p(748, 842)], 18),
  sk([p(190, 490), p(190, 556), p(248, 556), p(248, 490), p(190, 490)], 19), sk([p(290, 480), p(286, 552), p(352, 552), p(352, 482), p(290, 480)], 20),
  sk([p(190, 640), p(186, 708), p(250, 708), p(254, 640), p(190, 640)], 21), sk([p(640, 470), p(644, 544), p(708, 540), p(702, 468), p(640, 470)], 22),
  sk([p(198, 790), p(194, 856), p(262, 854), p(262, 788), p(198, 790)], 23), sk([p(650, 770), p(654, 846), p(716, 842), p(712, 770), p(650, 770)], 24),
  sk([p(40, 1010), p(1050, 980)], 25), sk([p(20, 1122), p(1060, 1094)], 26), sk([p(40, 1010), p(20, 1122)], 27), sk([p(1050, 980), p(1060, 1094)], 28),
  sk([p(70, 1190), p(960, 1166)], 29), sk([p(300, 1122), p(296, 1300)], 30), sk([p(640, 1112), p(644, 1290)], 31),
  sk(facet(sample("M150,1020 L146,920 Q150,890 180,888 L240,888 Q270,890 272,920 L268,1018", 8), 3, 32, 4), 33),
  sk([p(160, 884), p(164, 862), p(254, 862), p(258, 884)], 34),
  sk(facet(sample("M830,1040 L845,960 L950,958 L966,1036", 8), 3, 36, 3), 37), sk(facet(ellipsePts(897, 958, 56, 13, 22), 2, 38, 2), 39),
].join("");
const US_HATCH = [
  segD(scan([p(120, 1122), p(960, 1094), p(960, 1160), p(120, 1188)], 15, 62)),
  segD(scan([p(868, 480), p(1020, 505), p(1020, 640), p(868, 610)], 17, 118)),
  segD(scan([p(160, 720), p(320, 712), p(320, 840), p(160, 850)], 20, 58)),
].join("");
const SPLAT = new Array(26).fill(0).map((_, i) => {
  const r = rng(i + 90);
  const c = ["#d05b2e", "#3f7aa8", "#c99a32", "#7e8e5b"][Math.floor(r() * 4)];
  return <circle key={i} cx={100 + r() * 900} cy={120 + r() * 1140} r={1.2 + r() * r() * 7} fill={c} opacity={0.5} />;
});
const WashBlob = (pts: Pt[], _seed: number) => lineD(pts, true);
export const UrbanSketch: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const se = (Math.floor(sf / 3) % 3) + 1;
  const ink = "#1e1a17";
  const offCup = "translate(-16 10)";
  const local = (d: string, sd: number, ev = 6) => sk(facet(sample(d, 7), ev, sd, 3.2), sd + 5);
  return (
    <Stage bg="#efe7d6" defs={
      <>
        <filter id="us-w" {...region} colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={0.009} numOctaves={2} seed={12} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={40} xChannelSelector="R" yChannelSelector="G" result="d0" />
          <feGaussianBlur in="d0" stdDeviation={4} result="d" />
          <feGaussianBlur in="d" stdDeviation={12} result="b" />
          <feComposite in="d" in2="b" operator="arithmetic" k2={1} k3={-0.3} result="e" />
          <feTurbulence type="fractalNoise" baseFrequency={0.45} numOctaves={2} seed={3} result="g" />
          <feColorMatrix in="g" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 0.05" result="ga" />
          <feComposite in="e" in2="ga" operator="in" result="gr" />
          <feTurbulence type="fractalNoise" baseFrequency={0.007} numOctaves={4} seed={27} result="lo" />
          <feColorMatrix in="lo" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.4 0 0 0 -1.25" result="loa" />
          <feComposite in="gr" in2="loa" operator="in" />
        </filter>
        <filter id="us-p" {...region}><feTurbulence type="fractalNoise" baseFrequency={0.55} numOctaves={3} seed={2} /><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.18  0.8 0 0 0 -0.36" /></filter>
        <filter id="us-i" {...region}><feTurbulence type="fractalNoise" baseFrequency={0.09} numOctaves={2} seed={5} /><feDisplacementMap in="SourceGraphic" scale={2.4} /></filter>
        <clipPath id="us-rim"><path d={P.rim} /></clipPath>
        <linearGradient id="us-gut" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#3b2f22" stopOpacity={0.34} /><stop offset="1" stopColor="#3b2f22" stopOpacity={0} /></linearGradient>
      </>
    }>
      <rect width={W} height={H} filter="url(#us-p)" opacity={0.65} />
      <g style={{ mixBlendMode: "multiply" }} filter="url(#us-w)">
        <path d={WashBlob([p(90, 90), p(1000, 70), p(1020, 190), p(760, 170), p(70, 270)], 1)} fill="#4f95cf" opacity={0.85} />
        <path d={WashBlob([p(92, 306), p(740, 206), p(800, 352), p(70, 432)], 2)} fill="#d9401d" opacity={0.9} />
        <path d={WashBlob([p(166, 440), p(740, 410), p(760, 970), p(160, 1000)], 3)} fill="#e8a93f" opacity={0.6} />
        <path d={WashBlob([p(880, 170), p(1020, 200), p(1020, 640), p(880, 610)], 4)} fill="#8fa070" opacity={0.75} />
        <path d={WashBlob([p(40, 1030), p(1040, 996), p(1050, 1090), p(30, 1116)], 5)} fill="#8f5430" opacity={0.85} />
        <path d={WashBlob([p(60, 1140), p(990, 1110), p(960, 1300), p(100, 1320)], 6)} fill="#47708f" opacity={0.65} />
        <path d={WashBlob([p(156, 900), p(262, 896), p(262, 1012), p(152, 1016)], 7)} fill="#6f9b5e" opacity={0.75} />
        <path d={WashBlob([p(844, 964), p(948, 962), p(960, 1030), p(836, 1034)], 8)} fill="#c76e3c" opacity={0.75} />
      </g>
      <g opacity={0.72} filter="url(#us-i)">
        <path d={US_SCENE} stroke={ink} strokeWidth={2.6} {...round} />
        <path d={US_HATCH} stroke={ink} strokeWidth={1.8} {...round} opacity={0.6} />
      </g>
      <path d={P.kulhadBody} fill="#efe7d6" />
      <g style={{ mixBlendMode: "multiply" }} filter="url(#us-w)">
        <g transform={offCup}><path d={P.kulhadBody} fill="#d54f18" /></g>
        <path d="M600,830 L680,810 L640,1040 Q610,1056 575,1056 Z" fill="#7b2f18" opacity={0.5} />
      </g>
      <path d={P.rim} fill="#efe7d6" />
      <g clipPath="url(#us-rim)">
        <ellipse cx={540} cy={800} rx={170} ry={42} fill="#4a2c1a" opacity={0.42} />
        {s.level > 0 ? <ellipse cx={s.surface.cx - 6} cy={s.surface.cy + 3} rx={s.surface.rx} ry={s.surface.ry} fill="#a9642a" /> : null}
      </g>
      <path d={sk(facet(POLY.kulhadLine, 7, 41, 2.6), 42)} stroke={ink} strokeWidth={4.4} {...round} />
      <path d={sk(facet(sample(P.rim, 7), 4, 43, 2.4), 44)} stroke={ink} strokeWidth={3.8} {...round} />
      <path d={segD(scan([p(610, 815), p(705, 800), p(650, 1046), p(590, 1050)], 13, 22))} stroke={ink} strokeWidth={2.2} {...round} opacity={0.72} />
      {s.streaming ? (
        <>
          <path d={s.stream} stroke="#a9642a" strokeWidth={22} strokeLinecap="round" fill="none" opacity={0.92} style={{ mixBlendMode: "multiply" }} />
          <path d={s.stream} stroke={ink} strokeWidth={3} fill="none" strokeLinecap="round" transform="translate(11 0)" strokeDasharray="56 16" />
          <path d={s.stream} stroke={ink} strokeWidth={3} fill="none" strokeLinecap="round" transform="translate(-11 0)" strokeDasharray="30 28" />
        </>
      ) : null}
      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d={P.kettleBody} fill="#efe7d6" />
        <path d={P.kettleSpout} fill="#efe7d6" />
        <g style={{ mixBlendMode: "multiply" }}>
          <path d={P.kettleBody} fill="#4a7ea3" opacity={0.92} transform="translate(14 -10)" />
          <path d={P.kettleSpout} fill="#6d8ea5" opacity={0.7} transform="translate(8 -8)" />
          <path d="M40,-80 C150,-70 170,60 96,140 L30,140 C80,70 86,-20 40,-80 Z" fill="#2f4b61" opacity={0.58} />
          <path d={P.kettleLid} fill="#b7442b" opacity={0.85} />
        </g>
        <path d={local(P.kettleBody, se + 50, 5)} stroke={ink} strokeWidth={4.4} {...round} />
        <path d={local(P.kettleLid, se + 60, 5)} stroke={ink} strokeWidth={3.6} {...round} />
        <path d={local(P.kettleSpout, se + 70, 4)} stroke={ink} strokeWidth={4} {...round} />
        <path d={local(P.kettleHandle, se + 80, 5)} stroke={ink} strokeWidth={8} {...round} />
        <path d={local(P.kettleBand, se + 90, 6)} stroke={ink} strokeWidth={2.6} {...round} />
        <path d={lineD(wobble(ellipsePts(KNOB.x, KNOB.y, KNOB.r, KNOB.r, 12), se, 2, 2), true)} stroke={ink} strokeWidth={3.6} fill="#b7442b" />
        <path d={segD(scan([p(60, -60), p(140, -50), p(130, 110), p(70, 130)], 15, 28))} stroke={ink} strokeWidth={2} {...round} opacity={0.65} />
      </g>
      {s.steam.map((v, i) => (v > 0 ? <path key={i} d={lineD(facet(pathPts(steamPath(i, v, sf * 0.04)), 3, se + i, 3))} stroke={ink} strokeWidth={3} {...round} strokeDasharray="40 13 12 9" /> : null))}
      {SPLAT}
      <g style={{ mixBlendMode: "multiply" }}>
        {[["#d6502d", 700], ["#e2b35a", 762], ["#6fa7cf", 824], ["#5e7b92", 886], ["#6f9b5e", 948]].map(([c, x]) => (
          <rect key={c as string} x={x as number} y={1250} width={50} height={46} rx={5} fill={c as string} opacity={0.72} transform={`rotate(${(((x as number) * 7) % 5) - 2} ${x} 1270)`} />
        ))}
      </g>
      <rect width={78} height={H} fill="url(#us-gut)" />
      <rect x={W - 16} width={16} height={H} fill="#cfc4ad" />
      <path d={`M${W - 12},0V${H}M${W - 7},0V${H}`} stroke="#9c9079" strokeWidth={1.4} />
    </Stage>
  );
};

/* ---------- 10 Crayon book: printed colouring-book outlines, wax scribbled inside and over them ---------- */
const CY = {
  sky: zigPts(scan([p(30, 30), p(1050, 30), p(1050, 1000), p(30, 1000)], 38, 16)),
  ground: zigPts(scan([p(30, 1012), p(1050, 1012), p(1050, 1320), p(30, 1320)], 34, -14)),
  sun: zigPts(scan(ellipsePts(190, 196, 100, 100), 20, 36)),
};
const crScribble = (poly: Pt[], gap: number, ang: number, sd: number, over = 8) => {
  const rows = scan(poly, gap, ang).map(([a, b], i) => {
    const r = rng(sd * 11 + i);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const o1 = (r() - 0.25) * over;
    const o2 = (r() - 0.25) * over;
    return [{ x: a.x - (dx / m) * o1, y: a.y - (dy / m) * o1 }, { x: b.x + (dx / m) * o2, y: b.y + (dy / m) * o2 }] as [Pt, Pt];
  });
  return lineD(zigPts(rows));
};
const CrayonStick: React.FC<{ x: number; y: number; r: number; c: string }> = ({ x, y, r, c }) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`}>
    <path d="M-120,-20 L60,-20 L104,-7 L118,0 L104,7 L60,20 L-120,20 Z" fill={c} stroke="#111" strokeWidth={8} strokeLinejoin="round" />
    <rect x={-100} y={-20} width={140} height={40} fill="#fff" opacity={0.25} />
    <path d="M-100,-20V20M40,-20V20" stroke="#111" strokeWidth={5} />
  </g>
);
export const Crayon: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const se = (Math.floor(sf / 3) % 3) + 1;
  const wax = (d: string, c: string, w: number) => <path d={d} stroke={c} strokeWidth={w} {...round} />;
  const K = `translate(${s.kx} ${s.ky}) rotate(${s.tilt})`;
  const ink = { stroke: "#111", ...round } as const;
  const surf = clampToRim(ellipsePts(s.surface.cx, s.surface.cy, s.surface.rx, s.surface.ry));
  return (
    <Stage bg="#fffdf6" defs={
      <>
        <filter id="cy-w" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.75 0.5" numOctaves={3} seed={6} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -3.7" result="m" />
          <feTurbulence type="fractalNoise" baseFrequency={0.05} numOctaves={2} seed={2} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={6} result="d" />
          <feComposite in="d" in2="m" operator="in" />
        </filter>
        <filter id="cy-w2" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.42 0.28" numOctaves={3} seed={16 + se} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  10 0 0 0 -3.9" result="m" />
          <feTurbulence type="fractalNoise" baseFrequency={0.05} numOctaves={2} seed={se + 3} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale={5} result="d" />
          <feComposite in="d" in2="m" operator="in" />
        </filter>
        <clipPath id="cy-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <g filter="url(#cy-w)">
        <path d={lineD(wobble(CY.sky, 1, 7, 2))} stroke="#5cb8f0" strokeWidth={30} {...round} />
        <path d={lineD(wobble(CY.ground, 3, 7, 2))} stroke="#ffb400" strokeWidth={30} {...round} />
        <path d={lineD(wobble(CY.sun, 5, 5, 2))} stroke="#ffe11a" strokeWidth={24} {...round} />
      </g>
      <circle cx={190} cy={196} r={102} {...ink} strokeWidth={14} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1={190 + Math.cos((a * Math.PI) / 180) * 128} y1={196 + Math.sin((a * Math.PI) / 180) * 128} x2={190 + Math.cos((a * Math.PI) / 180) * 172} y2={196 + Math.sin((a * Math.PI) / 180) * 172} {...ink} strokeWidth={14} />
      ))}
      <path d="M0,1010 Q540,990 1080,1012" {...ink} strokeWidth={14} />
      <CrayonStick x={220} y={1240} r={-8} c="#e8232b" />
      <CrayonStick x={560} y={1262} r={5} c="#7a3fc4" />
      <CrayonStick x={860} y={1228} r={-14} c="#14a33c" />
      {/* the objects knock the background wax out with clean paper, then get their own wax */}
      <path d={P.kulhadBody} fill="#fffdf6" />
      <path d={P.rim} fill="#fffdf6" />
      <g transform={K}>
        <path d={P.kettleBody} fill="#fffdf6" />
        <path d={P.kettleSpout} fill="#fffdf6" />
        <path d={P.kettleLid} fill="#fffdf6" />
      </g>
      {s.streaming ? <><path d={s.stream} stroke="#111" strokeWidth={50} {...round} /><path d={s.stream} stroke="#fffdf6" strokeWidth={30} {...round} /></> : null}
      {s.steam.map((v, i) => (v > 0 ? <g key={i}><path d={steamPath(i, v, sf * 0.04)} stroke="#111" strokeWidth={44} {...round} /><path d={steamPath(i, v, sf * 0.04)} stroke="#fffdf6" strokeWidth={26} {...round} /></g> : null))}
      <g filter="url(#cy-w2)">
        {wax(crScribble(POLY.body, 16, 72, se), "#ff5a1f", 13)}
        <g clipPath="url(#cy-rim)">
          {wax(crScribble(POLY.rim, 11, 8, se + 1), "#8d3a12", 14)}
          {s.level > 0 ? wax(crScribble(surf, 9, 12, se + 2, 3), "#7a3a12", 13) : null}
        </g>
        {s.streaming ? wax(s.stream, "#7a3a12", 26) : null}
        <g transform={K}>
          {wax(crScribble(POLY.kBody, 17, 60, se + 3), "#1a4fe0", 14)}
          {wax(crScribble(POLY.spout, 10, 35, se + 4), "#1a4fe0", 13)}
          {wax(crScribble(POLY.lid, 8, 8, se + 5), "#e8232b", 11)}
        </g>
        {s.steam.map((v, i) => (v > 0 ? <path key={i} d={steamPath(i, v, sf * 0.04)} stroke="#ff4fb0" strokeWidth={24} {...round} /> : null))}
      </g>
      <path d={P.kulhadOutline} {...ink} strokeWidth={17} />
      <path d={P.rim} {...ink} strokeWidth={15} />
      <g transform={K}>
        <path d={P.kettleHandle} stroke="#111" strokeWidth={40} {...round} />
        <path d={P.kettleHandle} stroke="#ffd400" strokeWidth={20} {...round} />
        <path d={P.kettleBody} {...ink} strokeWidth={17} />
        <path d={P.kettleSpout} {...ink} strokeWidth={15} />
        <path d={P.kettleLid} {...ink} strokeWidth={14} />
        <path d={P.kettleBand} {...ink} strokeWidth={11} />
        <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 3} fill="#ffd400" stroke="#111" strokeWidth={13} />
      </g>
    </Stage>
  );
};

/* ---------- 11 Watercolour: transparent washes, no line at all, pigment pooling at wet edges ---------- */
const wcFilter = (id: string, seed: number, scale: number, blur: number, edge: number) => (
  <filter id={id} {...region} colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency={0.011} numOctaves={4} seed={seed} result="warp" />
    <feDisplacementMap in="SourceGraphic" in2="warp" scale={scale} xChannelSelector="R" yChannelSelector="G" result="shape" />
    <feGaussianBlur in="shape" stdDeviation={blur} result="soft" />
    <feGaussianBlur in="soft" stdDeviation={15} result="wide" />
    <feComposite in="soft" in2="wide" operator="arithmetic" k1={0} k2={1} k3={-edge} k4={0} result="rimmed" />
    <feTurbulence type="fractalNoise" baseFrequency={0.5} numOctaves={3} seed={seed + 3} result="grain" />
    <feColorMatrix in="grain" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -0.34" result="ga" />
    <feComposite in="rimmed" in2="ga" operator="in" />
  </filter>
);
export const Watercolour: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const se = Math.floor(sf / 6) % 3;
  const K = `translate(${s.kx} ${s.ky}) rotate(${s.tilt})`;
  const mm = { mixBlendMode: "multiply" } as const;
  return (
    <Stage bg="#fbf8f0" defs={
      <>
        {wcFilter("wc-bg", 4, 34, 3.5, 0.3)}
        {wcFilter("wc-cup", 9, 12, 2.2, 0.4)}
        {wcFilter("wc-bleed", 15, 70, 16, 0.08)}
        {wcFilter("wc-chai", 13, 14, 2.2, 0.32)}
        {wcFilter("wc-k", 20 + se, 14, 2.2, 0.42)}
        {wcFilter("wc-st", 31 + se, 70, 16, 0.1)}
        <filter id="wc-paper" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.06} numOctaves={4} seed={7} result="n" />
          <feDiffuseLighting in="n" surfaceScale={2.2} diffuseConstant={1.05} lightingColor="#fff"><feDistantLight azimuth={230} elevation={62} /></feDiffuseLighting>
        </filter>
        <linearGradient id="wc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f62b3" /><stop offset="0.5" stopColor="#7a8ccb" stopOpacity={0.85} /><stop offset="0.8" stopColor="#e39bb0" stopOpacity={0.8} /><stop offset="1" stopColor="#f7b16d" stopOpacity={0.9} /></linearGradient>
        <linearGradient id="wc-c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a33b12" /><stop offset="0.32" stopColor="#e06a26" stopOpacity={0.75} /><stop offset="0.7" stopColor="#b53d14" /><stop offset="1" stopColor="#6b220c" /></linearGradient>
        <linearGradient id="wc-kg" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stopColor="#10325e" /><stop offset="0.26" stopColor="#3f78ad" stopOpacity={0.8} /><stop offset="0.42" stopColor="#8fb7d3" stopOpacity={0.16} /><stop offset="0.6" stopColor="#3f78ad" stopOpacity={0.85} /><stop offset="1" stopColor="#0c2a4e" /></linearGradient>
        <clipPath id="wc-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <g style={mm} filter="url(#wc-bg)">
        <rect x={-60} y={-60} width={W + 120} height={1080} fill="url(#wc-sky)" />
        <ellipse cx={300} cy={140} rx={250} ry={70} fill="#1a3f8f" opacity={0.45} />
        <ellipse cx={820} cy={560} rx={260} ry={120} fill="#b05a9a" opacity={0.3} />
      </g>
      <g style={mm} filter="url(#wc-bg)">
        <rect x={-60} y={1000} width={W + 120} height={420} fill="#c9812c" />
        <ellipse cx={600} cy={1082} rx={290} ry={44} fill="#4b3760" opacity={0.85} />
      </g>
      <g style={mm} filter="url(#wc-bleed)">
        <path d={P.kulhadBody} fill="#d9642a" opacity={0.42} />
      </g>
      <g style={mm} filter="url(#wc-cup)">
        <path d={P.kulhadBody} fill="url(#wc-c)" />
      </g>
      <g style={mm} filter="url(#wc-cup)">
        <path d={P.rim} fill="#8c4a2a" opacity={0.75} />
      </g>
      {s.level > 0 ? (
        <g style={mm} filter="url(#wc-chai)">
          <g clipPath="url(#wc-rim)">
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx + 6} ry={s.surface.ry + 8} fill="#7a3e0c" />
            <ellipse cx={s.surface.cx - 20} cy={s.surface.cy - 4} rx={s.surface.rx * 0.6} ry={s.surface.ry * 0.5} fill="#c9791f" opacity={0.55} />
          </g>
          <ellipse cx={540} cy={900} rx={150 * s.level} ry={70 * s.level} fill="#8a4410" opacity={0.3} />
        </g>
      ) : null}
      {s.streaming ? (
        <g style={mm} filter="url(#wc-chai)">
          <path d={s.stream} stroke="#a65c14" strokeWidth={30} {...round} />
        </g>
      ) : null}
      <g style={mm} filter="url(#wc-bleed)">
        <g transform={K}><path d={P.kettleBody} fill="#2f5e94" opacity={0.3} /></g>
      </g>
      <g style={mm} filter="url(#wc-k)">
        <g transform={K}>
          <path d={P.kettleHandle} stroke="#1a2c3f" strokeWidth={26} {...round} />
          <path d={P.kettleSpout} fill="#2f5475" />
          <path d={P.kettleBody} fill="url(#wc-kg)" />
          <path d={P.kettleBand} stroke="#c8903a" strokeWidth={22} fill="none" opacity={0.75} />
        </g>
      </g>
      <g style={mm} filter="url(#wc-k)">
        <g transform={K}>
          <path d={P.kettleLid} fill="#b62a12" />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 3} fill="#7c2a1c" />
        </g>
      </g>
      <g style={mm} filter="url(#wc-st)">
        {s.steam.map((v, i) => (v > 0 ? <path key={i} d={steamPath(i, v, sf * 0.05)} stroke="#9b90c4" strokeOpacity={0.62} strokeWidth={70} {...round} /> : null))}
      </g>
      <rect width={W} height={H} filter="url(#wc-paper)" opacity={0.8} style={mm} />
      <path fillRule="evenodd" d={`M0,0H${W}V${H}H0Z M46,46H${W - 46}V${H - 46}H46Z`} fill="#fbf8f0" />
      <g opacity={0.92}>
        <rect x={-6} y={8} width={W + 12} height={54} fill="#e5d9b5" transform="rotate(-0.4 540 30)" />
        <rect x={-6} y={H - 62} width={W + 12} height={54} fill="#e5d9b5" transform={`rotate(0.3 540 ${H - 30})`} />
        <rect x={8} y={-6} width={54} height={H + 12} fill="#ded1ab" transform="rotate(0.3 30 675)" />
        <rect x={W - 62} y={-6} width={54} height={H + 12} fill="#ded1ab" transform={`rotate(-0.25 ${W - 30} 675)`} />
      </g>
    </Stage>
  );
};

void WK;
void mix;
