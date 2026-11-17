import { getLength, getPointAtLength } from "@remotion/paths";
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Paper, Rough, Stage } from "../../kit";
import { KETTLE_REST, KNOB, P, POUR_TILT, W, rot, steamPath, storyAt } from "../../story";

const KETTLE_T = `translate(${KETTLE_REST.x} ${KETTLE_REST.y}) rotate(${POUR_TILT})`;

/* ---------- 01 Whiteboard: a marker draws the whole story, then colours it in ---------- */
type Stroke = { d: string; a: number; b: number; c: string; w: number; kettle?: boolean; clip?: string; out?: [number, number] };

const zig = (x0: number, x1: number, y0: number, y1: number, step: number) => {
  let d = `M${x0},${y0}`;
  let y = y0;
  let right = true;
  while (y < y1) {
    d += ` L${right ? x1 : x0},${y + step * 0.5}`;
    y += step;
    right = !right;
  }
  return d;
};

const INK = "#1b2230";
const STEAM_FINAL = [0, 1, 2].map((i) => steamPath(i, 1, 0));
const STROKES: Stroke[] = [
  { d: P.kulhadOutline, a: 0, b: 13, c: INK, w: 7 },
  { d: P.rim, a: 16, b: 27, c: INK, w: 7 },
  { d: P.kettleBody, a: 30, b: 42, c: INK, w: 7, kettle: true },
  { d: P.kettleLid, a: 44, b: 48, c: INK, w: 7, kettle: true },
  { d: `M17,${KNOB.y} A17,17 0 1,0 -17,${KNOB.y} A17,17 0 1,0 17,${KNOB.y}`, a: 50, b: 52, c: INK, w: 7, kettle: true },
  { d: P.kettleSpout, a: 54, b: 58, c: INK, w: 7, kettle: true },
  { d: P.kettleHandle, a: 60, b: 64, c: INK, w: 7, kettle: true },
  { d: "M553,429 Q538,620 548,806", a: 66, b: 72, c: "#7a3d12", w: 16, out: [110, 118] },
  { d: zig(380, 700, 815, 1060, 26), a: 74, b: 96, c: "#c8643a", w: 18, clip: "wb-body" },
  { d: zig(380, 700, 765, 835, 13), a: 98, b: 110, c: "#7a3d12", w: 14, clip: "wb-rim" },
  { d: STEAM_FINAL[0], a: 112, b: 123, c: "#7b8798", w: 6 },
  { d: STEAM_FINAL[1], a: 125, b: 136, c: "#7b8798", w: 6 },
  { d: STEAM_FINAL[2], a: 138, b: 148, c: "#7b8798", w: 6 },
];
const LENGTHS = new Map(STROKES.map((s) => [s.d, getLength(s.d)]));

const worldPoint = (s: Stroke, p: number) => {
  const pt = getPointAtLength(s.d, p * (LENGTHS.get(s.d) as number))!;
  if (!s.kettle) return pt;
  const r = rot(pt.x, pt.y, POUR_TILT);
  return { x: r.x + KETTLE_REST.x, y: r.y + KETTLE_REST.y };
};

const penAt = (f: number) => {
  for (let i = 0; i < STROKES.length; i++) {
    const s = STROKES[i];
    if (f <= s.b) {
      if (f >= s.a) return worldPoint(s, (f - s.a) / (s.b - s.a));
      const prev = i === 0 ? { x: 900, y: 1250 } : worldPoint(STROKES[i - 1], 1);
      const from = i === 0 ? -6 : STROKES[i - 1].b;
      const next = worldPoint(s, 0);
      const k = (f - from) / (s.a - from);
      return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
    }
  }
  return null;
};

export const Whiteboard: React.FC = () => {
  const f = useCurrentFrame();
  const pen = penAt(f) ?? { x: 1000, y: 1300 };
  const lift = interpolate(f, [148, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const draw = (s: Stroke, i: number) => {
    const p = interpolate(f, [s.a, s.b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const gone = s.out ? interpolate(f, [s.out[0], s.out[1]], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
    if (p <= 0 || gone >= 1) return null;
    const el = (
      <path key={i} d={s.d} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} strokeDasharray={`${p - gone} 1`} strokeDashoffset={-gone} clipPath={s.clip ? `url(#${s.clip})` : undefined} />
    );
    return s.kettle ? <g key={i} transform={KETTLE_T}>{el}</g> : el;
  };
  const order = [8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  return (
    <Stage bg="#f6f5f0" defs={
      <>
        <clipPath id="wb-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="wb-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      {order.map((i) => draw(STROKES[i], i))}
      <g transform={`translate(${pen.x + 90 * lift} ${pen.y + 90 * lift}) rotate(32)`}>
        <path d="M-7,-4 L0,0 L7,-4 L10,-34 L-10,-34 Z" fill="#20283a" />
        <rect x={-19} y={-72} width={38} height={40} rx={6} fill="#c23b2e" />
        <rect x={-23} y={-300} width={46} height={232} rx={12} fill="#eceae2" stroke="#b7b2a4" strokeWidth={2} />
        <rect x={-23} y={-190} width={46} height={70} fill="#c23b2e" opacity={0.92} />
      </g>
    </Stage>
  );
};

/* ---------- 08 Hand-drawn: graphite and coloured pencil on paper, line boil on twos ---------- */
const GRAPHITE = "#39352f";
const hatch = (x0: number, x1: number, y0: number, y1: number, gap: number) => {
  let d = "";
  for (let x = x0; x < x1; x += gap) d += `M${x},${y0} L${x - 46},${y1} `;
  return d;
};

export const HandDrawn: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const seed = (Math.floor(sf / 2) % 6) + 1;
  const line = { fill: "none", stroke: GRAPHITE, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const Twice: React.FC<{ d: string; w?: number }> = ({ d, w = 5 }) => (
    <>
      <path d={d} {...line} strokeWidth={w} opacity={0.85} />
      <path d={d} {...line} strokeWidth={w * 0.55} opacity={0.5} transform="translate(3 -2)" />
    </>
  );
  return (
    <Stage bg="#efe6d3" defs={
      <>
        <Rough id="hd-a" seed={seed} freq={0.035} scale={9} />
        <clipPath id="hd-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="hd-rim"><path d={P.rim} /></clipPath>
        <clipPath id="hd-kettle"><path d={P.kettleBody} /></clipPath>
      </>
    }>
      <Paper id="hd-p" opacity={0.75} />
      <g filter="url(#hd-a)">
        <path d="M60,968 Q540,948 1020,970" {...line} strokeWidth={4} opacity={0.7} />
        <path d={hatch(360, 760, 1044, 1092, 12)} {...line} strokeWidth={3} opacity={0.42} />
        <g clipPath="url(#hd-body)">
          <rect x={360} y={770} width={360} height={320} fill="#c9764a" opacity={0.5} />
          <path d={hatch(560, 800, 790, 1080, 11)} {...line} strokeWidth={3.5} opacity={0.5} />
        </g>
        <Twice d={P.kulhadOutline} />
        <Twice d={P.rim} />
        <g clipPath="url(#hd-rim)">
          <ellipse cx={540} cy={838} rx={166} ry={40} fill="#6f4a30" opacity={0.3} />
          {s.level > 0 ? (
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#9c5a24" opacity={0.92} />
          ) : null}
        </g>
        {s.streaming ? (
          <>
            <path d={s.stream} fill="none" stroke="#9c5a24" strokeWidth={17} strokeLinecap="round" />
            <path d={s.stream} {...line} strokeWidth={2.5} opacity={0.65} transform="translate(9 0)" />
          </>
        ) : null}
        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={P.kettleBody} fill="#d9d6cc" opacity={0.75} />
          <g clipPath="url(#hd-kettle)">
            <path d={hatch(30, 210, -110, 150, 12)} {...line} strokeWidth={3.5} opacity={0.5} />
          </g>
          <Twice d={P.kettleBody} />
          <Twice d={P.kettleLid} />
          <Twice d={P.kettleSpout} />
          <Twice d={P.kettleHandle} w={6} />
          <Twice d={P.kettleBand} w={3} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="#d9d6cc" stroke={GRAPHITE} strokeWidth={4.5} />
        </g>
        {s.steam.map((p, i) =>
          p > 0 ? <path key={i} d={steamPath(i, p, sf * 0.05)} {...line} strokeWidth={4} opacity={0.58} /> : null,
        )}
      </g>
    </Stage>
  );
};

/* ---------- 23 Cut-out: layered construction paper, moved on threes ---------- */
export const CutOut: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const seed = (Math.floor(sf / 3) % 5) + 1;
  const n = (a: number) => Math.sin(Math.floor(sf / 3) * 12.9898 + a) * 1.6;
  return (
    <Stage bg="#e7b24a" defs={
      <>
        <Rough id="co-a" seed={seed} freq={0.05} scale={5} shadow />
        <clipPath id="co-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <g filter="url(#co-a)">
        <circle cx={880} cy={260} r={150} fill="#f4d68a" />
      </g>
      <g filter="url(#co-a)">
        <rect x={-20} y={960} width={W + 40} height={420} fill="#7d3f1f" transform={`translate(${n(1)} ${n(2)})`} />
      </g>
      <g filter="url(#co-a)">
        <rect x={-20} y={1120} width={W + 40} height={46} fill="#5e2c14" />
      </g>
      <g filter="url(#co-a)" transform={`translate(${n(3)} ${n(4)})`}>
        <path d={P.kulhadBody} fill="#c95f33" />
      </g>
      <g filter="url(#co-a)" transform={`translate(${n(3)} ${n(4)})`}>
        <path d={P.rim} fill="#a5461f" />
      </g>
      <g transform={`translate(${n(3)} ${n(4)})`} clipPath="url(#co-rim)">
        <g filter="url(#co-a)">
          <ellipse cx={540} cy={806} rx={156} ry={36} fill="#3c1c0c" />
        </g>
        {s.level > 0 ? (
          <g filter="url(#co-a)">
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#b8702a" />
          </g>
        ) : null}
      </g>
      {s.streaming ? (
        <g filter="url(#co-a)">
          <path d={s.stream} fill="none" stroke="#b8702a" strokeWidth={22} strokeLinecap="butt" />
        </g>
      ) : null}
      <g filter="url(#co-a)">
        <g transform={`translate(${s.kx + n(5)} ${s.ky + n(6)}) rotate(${s.tilt + n(7) * 0.4})`}>
          <path d={P.kettleHandle} fill="none" stroke="#27424f" strokeWidth={24} strokeLinecap="round" />
          <path d={P.kettleSpout} fill="#3f6b7c" />
          <path d={P.kettleBody} fill="#4f8496" />
          <path d={P.kettleBand} fill="none" stroke="#f1e3c4" strokeWidth={16} />
          <path d={P.kettleLid} fill="#27424f" />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 3} fill="#f1e3c4" />
        </g>
      </g>
      {s.steam.map((p, i) =>
        p > 0 ? (
          <g key={i} filter="url(#co-a)">
            <path d={steamPath(i, p, sf * 0.04)} fill="none" stroke="#fbf3df" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null,
      )}
      <Paper id="co-p" opacity={0.55} />
    </Stage>
  );
};
