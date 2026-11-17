// 85 Circuit board: a macro view of a green PCB. The kettle is a shaped package, the pour is current on a routed trace, the kulhad is a charging component.
import { loadFont } from "@remotion/google-fonts/ShareTechMono";
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { hash } from "./core";

const { fontFamily } = loadFont("normal", { weights: ["400"], subsets: ["latin"] });

const clampOpt = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const GOLD = "#d9b25a";
const CU = "#2a9a68";
const SILK = "#eaf4e6";
const HOT = "#ffcf6b";

type Tr = { d: string; ends: [number, number][] };
const snap = (v: number) => Math.round(v / 15) * 15;

const buildTraces = (): Tr[] => {
  const out: Tr[] = [];
  for (let i = 0; i < 90; i++) {
    let x = snap(hash(i, 1) * W);
    let y = snap(hash(i, 2) * H);
    let dir = Math.floor(hash(i, 3) * 8);
    const start: [number, number] = [x, y];
    let d = `M${x},${y}`;
    const n = 3 + Math.floor(hash(i, 4) * 3);
    for (let k = 0; k < n; k++) {
      const L = snap(60 + hash(i, k, 5) * 240);
      const a = (dir * Math.PI) / 4;
      x = x + Math.round(Math.cos(a)) * L;
      y = y + Math.round(Math.sin(a)) * L;
      d += ` L${x},${y}`;
      dir = (dir + (hash(i, k, 6) > 0.5 ? 1 : 7)) % 8;
    }
    out.push({ d, ends: [start, [x, y]] });
  }
  // Parallel buses, the signature of a routed board
  const busses = [
    { x: 60, y: 560, a: [[240, 0], [90, 90], [180, 0]] },
    { x: 690, y: 1120, a: [[120, 0], [120, -120], [90, 0]] },
    { x: 60, y: 1200, a: [[150, 0], [60, -60], [120, 0]] },
  ];
  busses.forEach((b, bi) => {
    for (let j = 0; j < 6; j++) {
      let x = b.x;
      let y = b.y + j * 18;
      let d = `M${x},${y}`;
      b.a.forEach(([dx, dy]) => {
        x += dx;
        y += dy;
        d += ` L${x},${y}`;
      });
      out.push({ d, ends: [[b.x, b.y + j * 18], [x, y]] });
    }
    void bi;
  });
  return out;
};
const TRACES = buildTraces();

const Chip: React.FC<{ x: number; y: number; s: number; label?: string }> = ({ x, y, s, label }) => {
  const pins = Math.floor(s / 18);
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: pins }).map((_, i) => {
        const p = -s / 2 + 10 + (i * (s - 20)) / (pins - 1);
        return (
          <g key={i}>
            <rect x={p - 3.5} y={-s / 2 - 16} width={7} height={18} fill="#c9ccd1" />
            <rect x={p - 3.5} y={s / 2 - 2} width={7} height={18} fill="#c9ccd1" />
            <rect x={-s / 2 - 16} y={p - 3.5} width={18} height={7} fill="#c9ccd1" />
            <rect x={s / 2 - 2} y={p - 3.5} width={18} height={7} fill="#c9ccd1" />
          </g>
        );
      })}
      <rect x={-s / 2} y={-s / 2} width={s} height={s} fill="#17181c" rx={5} />
      <rect x={-s / 2 + 4} y={-s / 2 + 4} width={s - 8} height={s - 8} fill="none" stroke="#2d2f36" strokeWidth={2} rx={3} />
      <circle cx={-s / 2 + 18} cy={-s / 2 + 18} r={6} fill="#3a3c44" />
      {label ? <text x={0} y={10} textAnchor="middle" fontFamily={fontFamily} fontSize={Math.round(s * 0.2)} fill="#9aa0aa">{label}</text> : null}
    </g>
  );
};

const smd = (x: number, y: number, v: boolean, body: string) => (
  <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${v ? 90 : 0})`}>
    <rect x={-22} y={-11} width={44} height={22} fill="#c9ccd1" />
    <rect x={-13} y={-11} width={26} height={22} fill={body} />
  </g>
);

export const CircuitBoard: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const pour = storyAt(60).tip;
  const route = `M${pour.x.toFixed(1)},${pour.y.toFixed(1)} L${pour.x.toFixed(1)},525 L465,620 L465,700 L548,783 L548,${s.surface.cy.toFixed(1)}`;
  const head = interpolate(f, [42, 54], [0, 1], clampOpt);
  const tail = interpolate(f, [96, 106], [0, 1], clampOpt);
  const flowing = head > 0 && tail < 1;
  const segs = 9;
  const lit = Math.ceil(s.level * segs - 0.01);
  const ledOn = f >= 100;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#093324" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="cb-sheen" x1={0} y1={0} x2={1} y2={1}>
            <stop offset={0} stopColor="#fff" stopOpacity={0} />
            <stop offset={0.5} stopColor="#d6ffe9" stopOpacity={0.14} />
            <stop offset={1} stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <filter id="cb-weave" {...region}>
            <feTurbulence type="fractalNoise" baseFrequency="0.55 0.9" numOctaves={3} seed={11} />
            <feColorMatrix values="0 0 0 0 0.85  0 0 0 0 1  0 0 0 0 0.9  0 0 0 0.7 -0.3" />
          </filter>
          <filter id="cb-glow" {...region}>
            <feGaussianBlur stdDeviation={9} result="a" />
            <feGaussianBlur in="SourceGraphic" stdDeviation={24} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="a" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="cb-body"><path d={P.kulhadBody} /></clipPath>
          <clipPath id="cb-rim"><path d={P.rim} /></clipPath>
        </defs>

        <rect width={W} height={H} fill="#0b3b2a" />
        <rect width={W} height={H} filter="url(#cb-weave)" opacity={0.55} />

        {/* Background copper under the mask */}
        {TRACES.map((t, i) => (
          <path key={i} d={t.d} fill="none" stroke={CU} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" opacity={0.6} />
        ))}
        {TRACES.map((t, i) => (
          <g key={i}>
            {t.ends.map(([x, y], k) => (
              <g key={k}>
                <circle cx={x} cy={y} r={11} fill={GOLD} />
                <circle cx={x} cy={y} r={4.5} fill="#06170f" />
              </g>
            ))}
          </g>
        ))}
        {/* Idle signals */}
        {TRACES.slice(0, 26).map((t, i) => (
          <path key={i} d={t.d} fill="none" stroke="#b6ffdc" strokeWidth={4} strokeLinecap="round" pathLength={1} strokeDasharray="0.05 0.95" strokeDashoffset={-(hash(i, 30) + f * (0.006 + hash(i, 31) * 0.01))} opacity={0.75} />
        ))}

        {/* Components */}
        <Chip x={170} y={340} s={210} label="CHAI" />
        <Chip x={195} y={820} s={120} />
        <Chip x={905} y={730} s={150} label="POUR" />
        <Chip x={905} y={1060} s={100} />
        {[850, 880, 910, 940, 970].map((x, i) => smd(x, 900, true, i % 2 ? "#23252b" : "#c7a173"))}
        {[120, 170, 220, 270].map((x, i) => smd(x, 1040, false, i % 2 ? "#c7a173" : "#23252b"))}
        {[[330, 1250], [760, 1220], [80, 110], [1000, 110]].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={34} fill={GOLD} />
            <circle cx={x} cy={y} r={22} fill="#04100b" />
          </g>
        ))}
        {[[800, 560], [960, 560]].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={44} fill="#c9ccd1" />
            <circle cx={x} cy={y} r={36} fill="#2b2d33" />
            <path d={`M${x - 36},${y} A36,36 0 0,1 ${x + 36},${y} Z`} fill="#3f424a" />
          </g>
        ))}

        {/* The main route: always printed, carries current during the pour */}
        <path d={route} fill="none" stroke={GOLD} strokeWidth={20} strokeLinejoin="round" strokeLinecap="round" />
        <path d={route} fill="none" stroke="#7d5f1f" strokeWidth={10} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pour.x} cy={pour.y} r={24} fill={GOLD} />
        <circle cx={pour.x} cy={pour.y} r={10} fill="#04100b" />
        <rect x={pour.x - 160} y={542} width={108} height={46} fill="#0b3b2a" />
        <text x={pour.x - 150} y={578} fontFamily={fontFamily} fontSize={38} fill={SILK}>POUR</text>
        <path d={`M${pour.x - 54},${556} L${pour.x - 22},${556}`} stroke={SILK} strokeWidth={4} />
        {flowing ? (
          <g filter="url(#cb-glow)">
            <path d={route} fill="none" stroke={HOT} strokeWidth={15} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={`${head - tail} 1`} strokeDashoffset={-tail} />
          </g>
        ) : null}
        {flowing ? (
          <path d={route} fill="none" stroke="#fffbe8" strokeWidth={11} strokeLinecap="round" pathLength={1} strokeDasharray="0.012 0.05" strokeDashoffset={-f * 0.022} opacity={head > 0.98 ? 1 : 0.4} />
        ) : null}

        {/* Steam: three serpentines that light up in turn */}
        {[0, 1, 2].map((i) => (
          <path key={i} d={steamPath(i, 1, 0)} fill="none" stroke={CU} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {s.steam.map((p, i) =>
          p > 0 ? (
            <path key={i} d={steamPath(i, p, 0)} fill="none" stroke="#e8fff4" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" filter="url(#cb-glow)" />
          ) : null,
        )}

        {/* Cup-shaped component: charge bars rise inside it */}
        {[840, 900, 960, 1020].map((y) => (
          <g key={y}>
            <rect x={332} y={y - 10} width={70} height={20} fill="#c9ccd1" />
            <rect x={678} y={y - 10} width={70} height={20} fill="#c9ccd1" />
          </g>
        ))}
        <path d={P.kulhadBody} fill="#17181c" stroke={GOLD} strokeWidth={8} strokeLinejoin="round" />
        <g clipPath="url(#cb-body)">
          {Array.from({ length: segs }).map((_, i) => {
            const y = 1034 - i * 26;
            const on = i < lit;
            return <rect key={i} x={380} y={y} width={320} height={18} fill={on ? HOT : "#2a2d33"} opacity={on ? 1 : 0.9} />;
          })}
        </g>
        <rect x={456} y={1072} width={168} height={52} fill="#0b3b2a" />
        <text x={540} y={1110} textAnchor="middle" fontFamily={fontFamily} fontSize={46} fill={SILK}>KULHAD</text>
        <path d={P.rim} fill="#0d0f12" stroke={GOLD} strokeWidth={9} />
        <g clipPath="url(#cb-rim)">
          {s.level > 0 ? (
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={HOT} filter="url(#cb-glow)" />
          ) : null}
        </g>

        {/* Ready LED fed from the cup */}
        <path d="M710,1035 L780,1105 L780,1160" fill="none" stroke={GOLD} strokeWidth={10} strokeLinejoin="round" />
        <rect x={756} y={1160} width={48} height={32} fill={ledOn ? "#ff3b30" : "#5a1f1c"} filter={ledOn ? "url(#cb-glow)" : undefined} />
        <text x={825} y={1190} fontFamily={fontFamily} fontSize={36} fill={SILK}>{ledOn ? "HOT" : "FILL"}</text>

        {/* Kettle-shaped package placed on the board */}
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={P.kettleHandle} fill="none" stroke={GOLD} strokeWidth={26} strokeLinecap="round" />
          <path d={P.kettleHandle} fill="none" stroke="#7d5f1f" strokeWidth={12} strokeLinecap="round" />
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x={-120 + i * 22} y={134} width={10} height={24} fill="#c9ccd1" />
          ))}
          <path d={P.kettleSpout} fill={GOLD} stroke="#7d5f1f" strokeWidth={4} />
          <path d={P.kettleBody} fill="#17181c" stroke="#3a3c44" strokeWidth={6} strokeLinejoin="round" />
          <path d={P.kettleBand} fill="none" stroke={SILK} strokeWidth={4} />
          <path d={P.kettleLid} fill={GOLD} stroke="#7d5f1f" strokeWidth={4} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 2} fill="#c9ccd1" />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r - 7} fill="#2b2d33" />
          <circle cx={-96} cy={10} r={10} fill="#3a3c44" />
          <text x={0} y={22} textAnchor="middle" fontFamily={fontFamily} fontSize={62} fill="#aab0ba">CHAI</text>
          <text x={0} y={120} textAnchor="middle" fontFamily={fontFamily} fontSize={26} fill="#6d727c">KETTLE</text>
          {flowing && tail === 0 ? <circle cx={-251} cy={-62} r={15} fill={HOT} filter="url(#cb-glow)" /> : null}
        </g>

        <rect width={W} height={H} fill="url(#cb-sheen)" transform={`translate(${(f - 75) * 3} 0)`} />
      </svg>
    </div>
  );
};
