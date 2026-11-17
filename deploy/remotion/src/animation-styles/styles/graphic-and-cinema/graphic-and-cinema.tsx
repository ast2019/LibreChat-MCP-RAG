// Group d: typographic, graphic-design and early-cinema styles. One story, twelve languages.
import { loadFont as loadAlfa } from "@remotion/google-fonts/AlfaSlabOne";
import { loadFont as loadLimelight } from "@remotion/google-fonts/Limelight";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, rot, steamPath, storyAt } from "../../story";
const FONT_LIME = loadLimelight("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const FONT_OSWALD = loadOswald("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily;
const FONT_ALFA = loadAlfa("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
type S = ReturnType<typeof storyAt>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ramp = (f: number, a: number, b: number) => clamp01((f - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const world = (s: S, x: number, y: number) => {
  const r = rot(x, y, s.tilt);
  return { x: s.kx + r.x, y: s.ky + r.y };
};
const kettleT = (s: S, dx = 0, dy = 0) => `translate(${s.kx + dx} ${s.ky + dy}) rotate(${s.tilt})`;
/* ---------- 39 Memphis diorama: a loud little model set, built from extruded laminate ---------- */
const VP = { x: 540, y: 420 };
const mp = (X: number, Y: number, z: number) => [VP.x + X / z, VP.y + Y / z] as const;
const poly = (pts: ReadonlyArray<readonly [number, number] | readonly number[]>) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const BACK = 1.613;

const Extrude: React.FC<{ n?: number; ds?: number; children: (side: boolean, i: number) => React.ReactNode }> = ({ n = 12, ds = 0.0062, children }) => (
  <>
    {Array.from({ length: n }, (_, i) => {
      const k = 1 - (n - i) * ds;
      return (
        <g key={i} transform={`translate(${VP.x} ${VP.y}) scale(${k}) translate(${-VP.x} ${-VP.y})`}>{children(true, i)}</g>
      );
    })}
    {children(false, n)}
  </>
);

const SQUIGGLES = (() => {
  let d = "";
  for (let i = 0; i < 16; i++) {
    const x = rnd(i + 1) * 150;
    const y = rnd(i + 40) * 150;
    const a = rnd(i + 80) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pt = (u: number, v: number) => `${(x + u * ca - v * sa).toFixed(1)},${(y + u * sa + v * ca).toFixed(1)}`;
    d += `M${pt(-13, 0)} Q${pt(-7, -13)} ${pt(0, 0)} T${pt(13, 0)} `;
  }
  return d;
})();
const CONFETTI = Array.from({ length: 34 }, (_, i) => ({
  x: 310 + rnd(i + 200) * 460,
  y: 1124 + rnd(i + 300) * 216,
  r: rnd(i + 400) * 180,
  s: 9 + rnd(i + 500) * 16,
  c: ["#111", "#ff4f9a", "#18c2b8", "#6a4cff", "#ffd23f"][i % 5],
}));

export const MemphisDiorama: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const cam = Math.sin(sf * 0.05) * 9;
  const PK = "#ff4f9a";
  const TL = "#18c2b8";
  const YL = "#ffd23f";
  const PU = "#6a4cff";
  const K = "#111";
  const floor = [] as React.ReactNode[];
  const zs = [1, 1.08, 1.17, 1.27, 1.38, 1.5, BACK];
  for (let r = 0; r < zs.length - 1; r++) {
    for (let c = 0; c < 8; c++) {
      const X0 = -540 + c * 135;
      const X1 = X0 + 135;
      floor.push(
        <polygon key={`${r}${c}`} points={poly([mp(X0, 930, zs[r]), mp(X1, 930, zs[r]), mp(X1, 930, zs[r + 1]), mp(X0, 930, zs[r + 1])])} fill={(r + c) % 2 ? K : "#f8f4e8"} />,
      );
    }
  }
  const stripes = [] as React.ReactNode[];
  for (let j = 0; j < 9; j++) {
    const z0 = lerp(1, BACK, j / 9);
    const z1 = lerp(1, BACK, (j + 1) / 9);
    if (j % 2 === 0) stripes.push(<polygon key={j} points={poly([mp(540, -420, z0), mp(540, -420, z1), mp(540, 930, z1), mp(540, 930, z0)])} fill={K} />);
  }
  const dots = [] as React.ReactNode[];
  for (let j = 0; j < 6; j++) {
    for (let k = 0; k < 7; k++) {
      const z = lerp(1.03, BACK - 0.03, (j + (k % 2) * 0.5) / 6);
      const Y = -380 + k * 200;
      const [x, y] = mp(-540, Y, z);
      dots.push(<ellipse key={`${j}${k}`} cx={x} cy={y} rx={22 / (z * z)} ry={44 / z} fill={K} />);
    }
  }
  const knob = world(s, KNOB.x, KNOB.y);
  const kettle = (side: boolean) => (
    <g transform={kettleT(s, cam)}>
      <path d={P.kettleHandle} fill="none" stroke={side ? "#2b1a55" : YL} strokeWidth={34} strokeLinecap="round" />
      <path d={P.kettleSpout} fill={side ? "#2b1a55" : YL} stroke={K} strokeWidth={side ? 0 : 7} />
      <path d={P.kettleBody} fill={side ? "#2b1a55" : TL} stroke={K} strokeWidth={side ? 0 : 7} />
      {side ? null : (
        <>
          <path d={P.kettleBody} fill="url(#mm-stripe)" />
          <path d={P.kettleBand} fill="none" stroke={YL} strokeWidth={18} />
        </>
      )}
      <path d={P.kettleLid} fill={side ? "#2b1a55" : PU} stroke={K} strokeWidth={side ? 0 : 6} />
      <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 4} fill={side ? "#2b1a55" : PK} stroke={K} strokeWidth={side ? 0 : 6} />
    </g>
  );
  const squig = "M-110,0 q28,-62 56,0 t56,0 t56,0 t56,0";
  return (
    <Stage bg="#222" defs={
      <>
        <pattern id="mm-bac" width={150} height={150} patternUnits="userSpaceOnUse">
          <rect width={150} height={150} fill={PK} />
          <path d={SQUIGGLES} fill="none" stroke={K} strokeWidth={6} strokeLinecap="round" />
        </pattern>
        <pattern id="mm-stripe" width={34} height={34} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={12} height={34} fill={K} />
        </pattern>
        <pattern id="mm-zig" width={70} height={46} patternUnits="userSpaceOnUse">
          <rect width={70} height={46} fill="#ff7a2e" />
          <path d="M0,34 L17.5,12 L35,34 L52.5,12 L70,34" fill="none" stroke={K} strokeWidth={8} />
        </pattern>
        <clipPath id="mm-rim"><path d={P.rim} /></clipPath>
        <radialGradient id="mm-vig" cx="50%" cy="42%" r="78%">
          <stop offset="55%" stopColor="#000" stopOpacity={0} />
          <stop offset="100%" stopColor="#14002a" stopOpacity={0.5} />
        </radialGradient>
      </>
    }>
      <g transform={`translate(${cam * 0.35} 0)`}>
        <polygon points={poly([mp(-540, -420, 1), mp(540, -420, 1), mp(540, -420, BACK), mp(-540, -420, BACK)])} fill={PU} />
        <polygon points={poly([mp(-540, -420, 1), mp(-540, -420, BACK), mp(-540, 930, BACK), mp(-540, 930, 1)])} fill={YL} />
        {dots}
        <polygon points={poly([mp(540, -420, 1), mp(540, -420, BACK), mp(540, 930, BACK), mp(540, 930, 1)])} fill={TL} />
        {stripes}
        {floor}
        <rect x={205} y={160} width={670} height={837} fill="url(#mm-bac)" stroke={K} strokeWidth={8} />
        <rect x={205} y={160} width={670} height={190} fill="#000" opacity={0.08} />
      </g>
      <g transform={`translate(${cam * 0.7} 0)`}>
        <ellipse cx={205} cy={1034} rx={118} ry={30} fill="#000" opacity={0.4} />
        <rect x={140} y={720} width={130} height={315} fill="url(#mm-stripe)" />
        <rect x={140} y={720} width={130} height={315} fill="none" stroke={K} strokeWidth={8} />
        <rect x={120} y={688} width={170} height={40} fill={YL} stroke={K} strokeWidth={8} />
        <circle cx={205} cy={622} r={68} fill={PK} stroke={K} strokeWidth={8} />
        <circle cx={185} cy={600} r={18} fill="#fff" opacity={0.8} />
        <ellipse cx={892} cy={1040} rx={112} ry={26} fill="#000" opacity={0.4} />
        <polygon points="892,735 985,1040 800,1040" fill={YL} stroke={K} strokeWidth={8} />
        <polygon points="892,735 985,1040 892,1040" fill={PU} stroke={K} strokeWidth={8} />
        <g transform="translate(330 288) rotate(-8)">
          <path d={squig} fill="none" stroke={K} strokeWidth={36} strokeLinecap="round" transform="translate(-5 8)" />
          <path d={squig} fill="none" stroke={TL} strokeWidth={24} strokeLinecap="round" />
        </g>
      </g>
      <g transform={`translate(${cam} 0)`}>
        <polygon points="300,1110 780,1110 750,1025 330,1025" fill="#f8f4e8" stroke={K} strokeWidth={7} />
        <rect x={300} y={1110} width={480} height={260} fill="#f8f4e8" stroke={K} strokeWidth={8} />
        {CONFETTI.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={c.s} height={c.s * 0.55} fill={c.c} transform={`rotate(${c.r} ${c.x} ${c.y})`} />
        ))}
        <ellipse cx={540} cy={1068} rx={150} ry={26} fill="#000" opacity={0.35} />
      </g>
      <g transform={`translate(${cam} 0)`}>
        <Extrude>
          {(side) => <path d={P.kulhadBody} fill={side ? K : "url(#mm-zig)"} stroke={K} strokeWidth={side ? 0 : 7} />}
        </Extrude>
        <path d={P.rim} fill="#2a1436" stroke={K} strokeWidth={8} />
        <g clipPath="url(#mm-rim)">
          {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#c9791f" /> : null}
          {s.level > 0 ? <ellipse cx={s.surface.cx - 50} cy={s.surface.cy - 8} rx={s.surface.rx * 0.34} ry={s.surface.ry * 0.28} fill="#f0ae55" /> : null}
        </g>
      </g>
      {s.streaming ? (
        <g transform={`translate(${cam} 0)`}>
          <path d={s.stream} fill="none" stroke={K} strokeWidth={44} strokeLinecap="round" />
          <path d={s.stream} fill="none" stroke="#e08a28" strokeWidth={30} strokeLinecap="round" />
        </g>
      ) : null}
      <rect x={knob.x + cam - 7} y={-20} width={14} height={Math.max(0, knob.y + 20)} fill={YL} stroke={K} strokeWidth={4} />
      <Extrude n={16} ds={0.0075}>{(side) => kettle(side)}</Extrude>
      {s.steam.map((p, i) =>
        p > 0 ? (
          <g key={i} transform={`translate(${cam} 0)`}>
            <path d={steamPath(i, p, sf * 0.04)} fill="none" stroke={K} strokeWidth={36} strokeLinecap="round" strokeLinejoin="round" transform="translate(-7 9)" />
            <path d={steamPath(i, p, sf * 0.04)} fill="none" stroke="#fffdf4" strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null,
      )}
      <rect width={W} height={H} fill="url(#mm-vig)" />
    </Stage>
  );
};

/* ---------- shared film damage, tuned differently per film stock ---------- */
const Damage: React.FC<{ id: string; f: number; grain: number; scratch: number; fleck: number; tone?: string }> = ({ id, f, grain, scratch, fleck, tone = "#fff" }) => {
  const n = Math.floor(f / 2);
  const lines = Array.from({ length: scratch }, (_, i) => {
    const x = rnd(n * 3 + i * 7.3) * W;
    const on = rnd(n * 5 + i) > 0.35;
    if (!on) return null;
    return <line key={i} x1={x} x2={x + (rnd(i + n) - 0.5) * 18} y1={rnd(n + i * 2) * 300 - 100} y2={H - rnd(n + i * 4) * 300 + 100} stroke={i % 3 ? tone : "#000"} strokeWidth={0.8 + rnd(i + n * 2) * 2.2} opacity={0.3 + rnd(i * 9 + n) * 0.5} />;
  });
  const flecks = Array.from({ length: fleck }, (_, i) => {
    const x = rnd(n * 11 + i * 3.1) * W;
    const y = rnd(n * 13 + i * 5.7) * H;
    const r = 1 + rnd(n + i * 8) * 6;
    return <ellipse key={i} cx={x} cy={y} rx={r} ry={r * (0.4 + rnd(i) * 0.9)} fill={i % 4 === 0 ? "#000" : tone} opacity={0.85} />;
  });
  return (
    <>
      <filter id={id} {...region}>
        <feTurbulence type="fractalNoise" baseFrequency={0.82} numOctaves={2} seed={(n % 23) + 1} />
        <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.4 0 0 0 -0.55" />
      </filter>
      <rect width={W} height={H} filter={`url(#${id})`} opacity={grain} style={{ mixBlendMode: "overlay" }} />
      {lines}
      {flecks}
    </>
  );
};

/* ---------- 70 Silent film: stage set, soft silver, oval matte, intertitles ---------- */
export const SilentFilm: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const n = sf / 2;
  const wx = (rnd(n + 1) - 0.5) * 7;
  const wy = (rnd(n + 2) - 0.5) * 9;
  const flicker = 0.04 + rnd(n + 3) * 0.2;
  const card1 = f < 16;
  const card2 = f >= 96 && f < 112;
  const irisOpen = ramp(f, 16, 28);
  const irisClose = ramp(f, 134, 150);
  const iris = lerp(lerp(180, 1100, outCubic(irisOpen)), 520, irisClose);
  const iy = lerp(760, 720, irisClose);
  const showCard = card1 || card2;
  return (
    <Stage bg="#0a0a0a" defs={
      <>
        <linearGradient id="sf-steel" x1="0" y1="0" x2="1" y2="0.1">
          <stop offset="0" stopColor="#3a3a3a" /><stop offset="0.3" stopColor="#ededed" /><stop offset="0.55" stopColor="#8a8a8a" /><stop offset="0.85" stopColor="#262626" /><stop offset="1" stopColor="#6c6c6c" />
        </linearGradient>
        <linearGradient id="sf-clay" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6e6e6e" /><stop offset="0.4" stopColor="#b5b5b5" /><stop offset="1" stopColor="#3c3c3c" />
        </linearGradient>
        <linearGradient id="sf-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5c5c5c" /><stop offset="0.75" stopColor="#8f8f8f" /><stop offset="1" stopColor="#6c6c6c" />
        </linearGradient>
        <linearGradient id="sf-fold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1e1e1e" /><stop offset="0.5" stopColor="#5a5a5a" /><stop offset="1" stopColor="#141414" />
        </linearGradient>
        <linearGradient id="sf-cloth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4e4e4" /><stop offset="1" stopColor="#8e8e8e" />
        </linearGradient>
        <pattern id="sf-paper" width={84} height={84} patternUnits="userSpaceOnUse">
          <path d="M42,10 L54,42 L42,74 L30,42 Z" fill="#000" opacity={0.1} />
          <circle cx={0} cy={0} r={7} fill="#000" opacity={0.1} /><circle cx={84} cy={0} r={7} fill="#000" opacity={0.1} /><circle cx={0} cy={84} r={7} fill="#000" opacity={0.1} /><circle cx={84} cy={84} r={7} fill="#000" opacity={0.1} />
        </pattern>
        <clipPath id="sf-rim"><path d={P.rim} /></clipPath>
        <filter id="sf-soft" {...region}><feGaussianBlur stdDeviation={1.5} /></filter>
        <filter id="sf-steam" {...region}><feGaussianBlur stdDeviation={8} /></filter>
        <radialGradient id="sf-oval" cx="50%" cy="50%" r="62%">
          <stop offset="62%" stopColor="#000" stopOpacity={0} /><stop offset="88%" stopColor="#000" stopOpacity={0.72} /><stop offset="100%" stopColor="#000" stopOpacity={1} />
        </radialGradient>
      </>
    }>
      <g transform={`translate(${wx} ${wy})`}>
        {showCard ? (
          <g>
            <rect x={-10} y={-10} width={W + 20} height={H + 20} fill="#0b0b0b" />
            <rect x={100} y={220} width={880} height={910} fill="none" stroke="#e8e4da" strokeWidth={6} />
            <rect x={124} y={244} width={832} height={862} fill="none" stroke="#e8e4da" strokeWidth={2} />
            {[[124, 244, 1, 1], [956, 244, -1, 1], [124, 1106, 1, -1], [956, 1106, -1, -1]].map(([x, y, a, b], i) => (
              <path key={i} transform={`translate(${x} ${y}) scale(${a} ${b})`} d="M0,96 C20,50 50,20 96,0 M26,70 C12,40 40,12 70,26 C80,50 50,76 26,70 Z" fill="none" stroke="#e8e4da" strokeWidth={3} />
            ))}
            {card1 ? (
              <g textAnchor="middle" fontFamily={FONT_LIME} fill="#ece8dd">
                <text x={540} y={590} fontSize={74}>A CUP OF</text>
                <text x={540} y={800} fontSize={210}>CHAI</text>
                <path d="M340,880 H500 M580,880 H740 M540,866 L554,880 L540,894 L526,880 Z" stroke="#ece8dd" strokeWidth={4} fill="#ece8dd" />
              </g>
            ) : (
              <g textAnchor="middle" fontFamily={FONT_LIME} fill="#ece8dd">
                <text x={540} y={620} fontSize={118}>Piping</text>
                <text x={540} y={790} fontSize={118}>hot!</text>
                <path d="M340,880 H500 M580,880 H740 M540,866 L554,880 L540,894 L526,880 Z" stroke="#ece8dd" strokeWidth={4} fill="#ece8dd" />
              </g>
            )}
          </g>
        ) : (
          <g filter="url(#sf-soft)">
            <rect x={-10} y={-10} width={W + 20} height={H + 20} fill="url(#sf-wall)" />
            <rect x={-10} y={-10} width={W + 20} height={1010} fill="url(#sf-paper)" />
            <rect x={-10} y={760} width={W + 20} height={10} fill="#333" />
            {Array.from({ length: 5 }, (_, i) => <rect key={i} x={i * 44 - 20} y={-20} width={46} height={1090} fill="url(#sf-fold)" />)}
            {Array.from({ length: 5 }, (_, i) => <rect key={i} x={W - i * 44 - 26} y={-20} width={46} height={1090} fill="url(#sf-fold)" />)}
            <path d="M-10,985 H1090 V1120 H-10 Z" fill="url(#sf-cloth)" />
            <path d={`M-10,1110 ${Array.from({ length: 18 }, () => "q30,48 60,0").join(" ")} V1370 H-10 Z`} fill="#5f5f5f" />
            <path d={`M-10,1110 ${Array.from({ length: 18 }, () => "q30,48 60,0").join(" ")}`} fill="none" stroke="#efefef" strokeWidth={8} />
            <ellipse cx={560} cy={1066} rx={230} ry={32} fill="#000" opacity={0.5} />
            <path d={P.kulhadBody} fill="url(#sf-clay)" />
            <path d={P.kulhadOutline} fill="none" stroke="#151515" strokeWidth={5} />
            <path d={P.rim} fill="#2e2e2e" stroke="#c9c9c9" strokeWidth={5} />
            <g clipPath="url(#sf-rim)">
              {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#505050" /> : null}
              {s.level > 0 ? <ellipse cx={s.surface.cx - 40} cy={s.surface.cy - 7} rx={s.surface.rx * 0.5} ry={s.surface.ry * 0.3} fill="#8c8c8c" /> : null}
            </g>
            {s.streaming ? (
              <>
                <path d={s.stream} fill="none" stroke="#3e3e3e" strokeWidth={22} strokeLinecap="round" />
                <path d={s.stream} fill="none" stroke="#d0d0d0" strokeWidth={5} transform="translate(-5 0)" />
              </>
            ) : null}
            <g transform={kettleT(s)}>
              <path d={P.kettleHandle} fill="none" stroke="#1c1c1c" strokeWidth={26} strokeLinecap="round" />
              <path d={P.kettleSpout} fill="url(#sf-steel)" stroke="#1a1a1a" strokeWidth={4} />
              <path d={P.kettleBody} fill="url(#sf-steel)" stroke="#1a1a1a" strokeWidth={4} />
              <path d={P.kettleBand} fill="none" stroke="#2a2a2a" strokeWidth={7} />
              <path d={P.kettleLid} fill="#1f1f1f" />
              <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="#cfcfcf" stroke="#111" strokeWidth={4} />
            </g>
          </g>
        )}
        {!showCard ? (
          <g filter="url(#sf-steam)">
            {s.steam.map((p, i) => (p > 0 ? <path key={i} d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#f2f2f2" strokeWidth={24} strokeLinecap="round" opacity={0.75} /> : null))}
          </g>
        ) : null}
      </g>
      <rect width={W} height={H} fill="url(#sf-oval)" />
      {!showCard && (irisOpen < 1 || irisClose > 0) ? (
        <path fillRule="evenodd" d={`M-20,-20 H1100 V1370 H-20 Z M540,${iy - iris} a${iris},${iris} 0 1,0 0.1,0 Z`} fill="#000" />
      ) : null}
      <rect width={W} height={H} fill="#000" opacity={flicker} />
      <Damage id="sf-g" f={f} grain={0.5} scratch={4} fleck={7} />
    </Stage>
  );
};

/* ---------- 71 Newsreel: scratched reportage, punch-ins, slammed headlines ---------- */
const NEWS_SHOTS = [
  { a: 0, sc: 1, x: 540, y: 675, head: "" },
  { a: 42, sc: 1.42, x: 600, y: 610, head: "THE POUR BEGINS" },
  { a: 72, sc: 1.75, x: 540, y: 880, head: "CUP FILLS FAST" },
  { a: 104, sc: 1, x: 540, y: 690, head: "STEAM RISES" },
];

const GREEK = Array.from({ length: 30 }, (_, i) => ({ x: 26 + (i % 3) * 198, y: 322 + Math.floor(i / 3) * 40, w: 150 + rnd(i) * 30 }));

export const Newsreel: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const n = Math.floor(f / 2);
  const shotI = NEWS_SHOTS.reduce((acc, sh, i) => (f >= sh.a ? i : acc), 0);
  const shot = NEWS_SHOTS[shotI];
  const age = f - shot.a;
  const hx = (rnd(n + 1) - 0.5) * 12 + Math.sin(f * 0.21) * 4;
  const hy = (rnd(n + 5) - 0.5) * 12 + Math.cos(f * 0.17) * 4;
  const sc = shot.sc * (1 + age * 0.0016);
  const cam = `translate(${540 + hx} ${675 + hy}) scale(${sc}) translate(${-shot.x} ${-shot.y})`;
  const paperIn = outCubic(ramp(f, 0, 14));
  const paperOut = ramp(f, 24, 32);
  const paperRot = (1 - paperIn) * 900 - 5;
  const wipeOn = NEWS_SHOTS.some((sh) => sh.a > 0 && f >= sh.a - 3 && f < sh.a + 3);
  const nextA = NEWS_SHOTS.find((sh) => sh.a > 0 && f >= sh.a - 3 && f < sh.a + 3)?.a ?? 0;
  const wipeX = lerp(-300, 1500, (f - (nextA - 3)) / 6);
  const hIn = outCubic(ramp(age, 2, 9));
  const lum = 0.05 + rnd(n + 9) * 0.13;
  return (
    <AbsoluteFill style={{ background: "#0a0806" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id="nr-brick" width={120} height={72} patternUnits="userSpaceOnUse">
            <rect width={120} height={72} fill="#3e3a36" />
            <path d="M0,0 H120 M0,36 H120 M0,0 V36 M60,36 V72 M120,0 V36" stroke="#151310" strokeWidth={5} />
          </pattern>
          <pattern id="nr-plank" width={200} height={46} patternUnits="userSpaceOnUse">
            <rect width={200} height={46} fill="#26211c" />
            <path d="M0,0 H200 M90,0 V46" stroke="#0a0806" strokeWidth={4} />
          </pattern>
          <clipPath id="nr-rim"><path d={P.rim} /></clipPath>
          <clipPath id="nr-body"><path d={P.kulhadBody} /></clipPath>
          <clipPath id="nr-kbody"><path d={P.kettleBody} /></clipPath>
          <radialGradient id="nr-vig" cx="50%" cy="50%" r="72%">
            <stop offset="60%" stopColor="#000" stopOpacity={0} /><stop offset="100%" stopColor="#000" stopOpacity={0.82} />
          </radialGradient>
          <radialGradient id="nr-flash" cx="42%" cy="36%" r="62%">
            <stop offset="0" stopColor="#fff" stopOpacity={0.36} /><stop offset="1" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
          <filter id="nr-rough" {...region}>
            <feTurbulence type="fractalNoise" baseFrequency={0.14} numOctaves={2} seed={(n % 5) + 2} result="t" />
            <feDisplacementMap in="SourceGraphic" in2="t" scale={3} />
          </filter>
        </defs>
        <g transform={cam} filter="url(#nr-rough)">
          <rect x={-300} y={-300} width={1700} height={1320} fill="url(#nr-brick)" />
          <rect x={-300} y={1020} width={1700} height={700} fill="url(#nr-plank)" />
          <rect x={-300} y={1008} width={1700} height={16} fill="#0a0806" />
          <g opacity={0.72}>
            <g transform={`translate(${s.kx + 96} ${s.ky + 86}) rotate(${s.tilt})`} fill="#060504">
              <path d={P.kettleBody} /><path d={P.kettleSpout} /><path d={P.kettleLid} />
            </g>
            <path d={P.kulhadBody} fill="#060504" transform="translate(110 -60)" />
          </g>
          <ellipse cx={590} cy={1066} rx={230} ry={24} fill="#000" />
          <path d={P.kulhadBody} fill="#8d8780" />
          <g clipPath="url(#nr-body)">
            <path d="M560,780 L700,780 L700,1090 L600,1090 Z" fill="#23201c" />
            <path d="M386,780 L440,780 L470,1090 L430,1090 Z" fill="#efeae0" />
          </g>
          <path d={P.kulhadOutline} fill="none" stroke="#0c0a08" strokeWidth={6} />
          <path d={P.rim} fill="#1a1714" stroke="#efeae0" strokeWidth={6} />
          <g clipPath="url(#nr-rim)">
            {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#544a3e" /> : null}
            {s.level > 0 ? <ellipse cx={s.surface.cx - 56} cy={s.surface.cy - 6} rx={s.surface.rx * 0.34} ry={s.surface.ry * 0.3} fill="#efeae0" /> : null}
          </g>
          {s.streaming ? (
            <>
              <path d={s.stream} fill="none" stroke="#2c2720" strokeWidth={24} strokeLinecap="round" />
              <path d={s.stream} fill="none" stroke="#f5f0e6" strokeWidth={6} transform="translate(-7 0)" />
            </>
          ) : null}
          <g transform={kettleT(s)}>
            <path d={P.kettleHandle} fill="none" stroke="#0c0a08" strokeWidth={30} strokeLinecap="round" />
            <path d={P.kettleSpout} fill="#b8b2a8" stroke="#0c0a08" strokeWidth={5} />
            <path d={P.kettleBody} fill="#b8b2a8" stroke="#0c0a08" strokeWidth={5} />
            <g clipPath="url(#nr-kbody)">
              <rect x={30} y={-120} width={170} height={280} fill="#2a2620" />
              <rect x={-112} y={-90} width={46} height={200} fill="#f6f1e7" />
                          </g>
            <path d={P.kettleLid} fill="#0c0a08" />
            <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="#f6f1e7" stroke="#0c0a08" strokeWidth={5} />
          </g>
          {s.steam.map((p, i) => (p > 0 ? <path key={i} d={steamPath(i, p, f * 0.06)} fill="none" stroke="#f6f1e7" strokeWidth={15} strokeLinecap="round" opacity={0.72} /> : null))}
        </g>
        <rect width={W} height={H} fill="url(#nr-flash)" />
        {paperOut < 1 ? (
          <g transform={`translate(${540 + paperOut * -1300} 950) rotate(${paperRot}) scale(${paperIn})`}>
            <g transform="translate(-320 -390)">
              <rect x={8} y={12} width={640} height={780} fill="#000" opacity={0.5} />
              <rect width={640} height={780} fill="#dcd6c8" />
              <rect x={24} y={24} width={592} height={10} fill="#16130f" />
              <rect x={24} y={74} width={592} height={4} fill="#16130f" />
              <text x={320} y={252} textAnchor="middle" fontFamily={FONT_ALFA} fontSize={168} fill="#16130f">CHAI!</text>
              <text x={320} y={302} textAnchor="middle" fontFamily={FONT_OSWALD} fontWeight={700} fontSize={40} letterSpacing={2} fill="#16130f">KETTLE ARRIVES</text>
              <rect x={26} y={44} width={280} height={18} fill="#16130f" opacity={0.55} />
              <rect x={334} y={44} width={280} height={18} fill="#16130f" opacity={0.55} />
              {GREEK.map((g, i) => <rect key={i} x={g.x} y={g.y} width={g.w} height={9} fill="#16130f" opacity={0.55} />)}
              <rect x={26} y={650} width={588} height={104} fill="#16130f" opacity={0.75} />
            </g>
          </g>
        ) : null}
        {shot.head ? (
          <g transform={`translate(${(1 - hIn) * -1200} 0) rotate(-3 540 1190)`}>
            <rect x={-60} y={1106} width={1240} height={176} fill="#0b0907" />
            <rect x={-60} y={1106} width={1240} height={10} fill="#efe9dc" />
            <rect x={-60} y={1272} width={1240} height={10} fill="#efe9dc" />
            <text x={540} y={1244} textAnchor="middle" fontFamily={FONT_OSWALD} fontWeight={700} fontSize={118} letterSpacing={3} fill="#f4eee1">{shot.head}</text>
          </g>
        ) : null}
        {wipeOn ? <polygon points={`${wipeX - 260},0 ${wipeX + 620},0 ${wipeX + 260},${H} ${wipeX - 620},${H}`} fill="#efe9dc" /> : null}
        <rect width={W} height={H} fill="#000" opacity={lum} />
        <rect width={W} height={H} fill="url(#nr-vig)" />
        <Damage id="nr-g" f={f} grain={0.72} scratch={13} fleck={20} tone="#f4eee1" />
        <path d={`M${rnd(n + 77) * W},${rnd(n + 78) * 500 + 200} q${(rnd(n) - 0.5) * 240},${80 + rnd(n + 2) * 100} ${(rnd(n + 3) - 0.5) * 160},${200 + rnd(n + 4) * 200}`} fill="none" stroke="#14110d" strokeWidth={3} />
        <rect width={W} height={H} fill="#b89b6a" opacity={0.22} style={{ mixBlendMode: "multiply" }} />
      </svg>
    </AbsoluteFill>
  );
};

