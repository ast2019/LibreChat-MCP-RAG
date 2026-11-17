// 84 Hologram HUD: a true lathe-built wireframe kettle and cup with spinning meridians, inside a cyan sci-fi instrument panel.
import { loadFont } from "@remotion/google-fonts/ShareTechMono";
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { region } from "../../kit";
import { H, W, steamPath, storyAt } from "../../story";
import { hash } from "./core";

const { fontFamily } = loadFont("normal", { weights: ["400"], subsets: ["latin"] });

const CY = "#49e8ff";
const DIM = "#1b89a6";
const OR = "#ffb03a";
const K = 0.247;
const clampOpt = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const n1 = (v: number) => v.toFixed(1);
const ringPts = (cy: number, r: number, cx = 0) => {
  let front = "";
  let back = "";
  const N = 40;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    const seg = `M${n1(cx + Math.cos(a) * r)},${n1(cy + Math.sin(a) * r * K)} L${n1(cx + Math.cos(b) * r)},${n1(cy + Math.sin(b) * r * K)} `;
    if (Math.sin((a + b) / 2) > 0) front += seg;
    else back += seg;
  }
  return { front, back };
};

// Lathe a profile into rings plus meridians. Rings stay put, meridians rotate.
const lathe = (Y: number[], R: number[], meridians: number, spin: number, cx = 0, ringEvery = 1) => {
  let front = "";
  let back = "";
  Y.forEach((y, i) => {
    if (i % ringEvery) return;
    const r = ringPts(y, R[i], cx);
    front += r.front;
    back += r.back;
  });
  for (let j = 0; j < meridians; j++) {
    const a = (j / meridians) * Math.PI * 2 + spin;
    let d = "";
    for (let i = 0; i < Y.length; i++) {
      const x = cx + Math.cos(a) * R[i];
      const yy = Y[i] + Math.sin(a) * R[i] * K;
      d += `${i ? "L" : "M"}${n1(x)},${n1(yy)} `;
    }
    if (Math.sin(a) > 0) front += d;
    else back += d;
  }
  return { front, back };
};

const bez = (p: number[], t: number) => {
  const u = 1 - t;
  return {
    x: u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
    y: u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
  };
};

// Sweep a circular section along a centreline.
const tube = (center: (t: number) => { x: number; y: number }, radius: (t: number) => number, rings: number, long: number, spin: number) => {
  let front = "";
  let back = "";
  const frameAt = (t: number) => {
    const a = center(Math.max(0, t - 0.02));
    const b = center(Math.min(1, t + 0.02));
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { nx: -dy / l, ny: dx / l };
  };
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = center(t);
    const { nx, ny } = frameAt(t);
    const r = radius(t);
    let d = "";
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = c.x + nx * r * Math.cos(a);
      const y = c.y + ny * r * Math.cos(a) + Math.sin(a) * r * K;
      d += `${k ? "L" : "M"}${n1(x)},${n1(y)} `;
    }
    front += d;
  }
  for (let j = 0; j < long; j++) {
    const a = (j / long) * Math.PI * 2 + spin;
    let d = "";
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const c = center(t);
      const { nx, ny } = frameAt(t);
      const r = radius(t);
      d += `${i ? "L" : "M"}${n1(c.x + nx * r * Math.cos(a))},${n1(c.y + ny * r * Math.cos(a) + Math.sin(a) * r * K)} `;
    }
    if (Math.sin(a) > 0) front += d;
    else back += d;
  }
  return { front, back };
};

const SPL = [-142, 32, -200, 12, -226, -30, -263, -50];
const SPU = [-130, -42, -170, -42, -206, -56, -240, -77];
const HND = [140, -42, 256, -74, 256, 94, 140, 92];
const spoutC = (t: number) => {
  const a = bez(SPL, t), b = bez(SPU, t);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
const spoutR = (t: number) => {
  const a = bez(SPL, t), b = bez(SPU, t);
  return Math.hypot(a.x - b.x, a.y - b.y) / 2;
};

const CUP_Y = [800, 840, 880, 920, 960, 1000, 1040, 1058];
const CUP_R = [170, 161, 152, 143, 134, 125, 116, 100];
const cupRadiusAt = (y: number) => interpolate(y, [800, 1040], [170, 116], clampOpt);

const STEPS: [string, number, number][] = [
  ["TILT", 24, 42],
  ["POUR", 42, 96],
  ["FILL", 44, 100],
  ["STEAM", 104, 150],
];

const Txt: React.FC<{ x: number; y: number; s: number; c?: string; a?: "start" | "middle" | "end"; children: React.ReactNode; o?: number }> = ({ x, y, s, c = CY, a = "start", children, o = 1 }) => (
  <text x={x} y={y} fontFamily={fontFamily} fontSize={s} fill={c} textAnchor={a} opacity={o}>{children}</text>
);

export const HologramHUD: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const spin = f * 0.018;
  const yFill = 1040 + (810 - 1040) * s.level;
  const head = interpolate(f, [42, 48], [0, 1], clampOpt);
  const tail = interpolate(f, [96, 102], [0, 1], clampOpt);

  const body = lathe([-70, -40, -8, 24, 56, 88, 118, 140], [130, 147, 156, 158, 152, 138, 116, 90], 16, spin);
  const lid = lathe([-86, -100, -118, -129], [92, 76, 44, 8], 10, spin * 1.4);
  const spout = tube(spoutC, spoutR, 7, 8, spin * 2);
  const handle = tube((t) => bez(HND, t), () => 13, 12, 5, spin * 2);
  const cup = lathe(CUP_Y, CUP_R, 22, -spin * 0.7, 540);

  // Fill: stacked rings inside the wire cup
  let fillRings = "";
  for (let y = 1040; y >= yFill; y -= 15) fillRings += ringPts(y, cupRadiusAt(y) - 10, 540).front + ringPts(y, cupRadiusAt(y) - 10, 540).back;
  const topR = cupRadiusAt(yFill) - 10;

  const tipX = s.tip.x;
  const tipY = s.tip.y;
  const y0 = tipY + (yFill - tipY) * tail;
  const yEnd = tipY + (yFill - tipY) * head;
  const x0 = tipX + (540 - tipX) * tail;
  const xEnd = tipX + (540 - tipX) * head;
  const flow = `M${n1(x0)},${n1(y0)} L${n1(xEnd)},${n1(yEnd)}`;

  // Global hologram instability
  const jit = hash(Math.floor(f / 2), 3) > 0.9 ? (hash(f, 4) - 0.5) * 12 : 0;
  const flick = 0.9 + hash(f, 8) * 0.1;

  // Level trace: only the cup level, drawn up to now
  const gx = 660;
  const gy = 1170;
  const gw = 340;
  const gh = 130;
  let trace = "";
  for (let i = 0; i <= f; i += 2) {
    const v = storyAt(i).level;
    trace += `${i ? "L" : "M"}${n1(gx + (i / 150) * gw)},${n1(gy + gh - v * gh)} `;
  }

  const arcR = 104;
  const arcC = { x: 196, y: 1196 };
  const arcAngle = -Math.PI / 2 + s.level * Math.PI * 2;
  const large = s.level > 0.5 ? 1 : 0;
  const arcPath = s.level > 0.001 && s.level < 0.999
    ? `M${arcC.x},${arcC.y - arcR} A${arcR},${arcR} 0 ${large} 1 ${n1(arcC.x + Math.cos(arcAngle) * arcR)},${n1(arcC.y + Math.sin(arcAngle) * arcR)}`
    : s.level >= 0.999
      ? `M${arcC.x},${arcC.y - arcR} A${arcR},${arcR} 0 1 1 ${arcC.x - 0.1},${arcC.y - arcR}`
      : "";

  const wire = (d: string, w: number, op: number, c = CY) => <path d={d} fill="none" stroke={c} strokeWidth={w} opacity={op} />;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#020910" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="hu-bg" cx="50%" cy="58%" r="74%">
            <stop offset={0} stopColor="#0a3144" />
            <stop offset={0.6} stopColor="#04151f" />
            <stop offset={1} stopColor="#01060b" />
          </radialGradient>
          <linearGradient id="hu-beam" x1={0} y1={1} x2={0} y2={0}>
            <stop offset={0} stopColor={CY} stopOpacity={0.3} />
            <stop offset={1} stopColor={CY} stopOpacity={0} />
          </linearGradient>
          <pattern id="hu-dots" width={40} height={40} patternUnits="userSpaceOnUse">
            <circle cx={2} cy={2} r={1.6} fill={CY} opacity={0.2} />
          </pattern>
          <pattern id="hu-scan" width={6} height={6} patternUnits="userSpaceOnUse">
            <rect width={6} height={2} fill="#000" opacity={0.3} />
          </pattern>
          <filter id="hu-glow" {...region}>
            <feGaussianBlur stdDeviation={7} result="a" />
            <feGaussianBlur in="SourceGraphic" stdDeviation={20} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="a" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width={W} height={H} fill="url(#hu-bg)" />
        <rect width={W} height={H} fill="url(#hu-dots)" />

        <g transform={`translate(${jit} 0)`} opacity={flick} filter="url(#hu-glow)">
          {/* Emitter beam and pad */}
          <path d="M300,1120 L780,1120 L700,560 L380,560 Z" fill="url(#hu-beam)" />
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={540} cy={1098} rx={190 + i * 62} ry={(190 + i * 62) * K} fill="none" stroke={CY} strokeWidth={i === 0 ? 4 : 2.5} opacity={0.75 - i * 0.14} strokeDasharray={i % 2 ? "26 16" : "none"} strokeDashoffset={f * (i % 2 ? 3 : 0)} />
          ))}

          {/* Cup */}
          {wire(cup.back, 1.6, 0.34)}
          {s.level > 0.001 ? wire(fillRings, 2.4, 0.9, OR) : null}
          {s.level > 0.001 ? <ellipse cx={540} cy={yFill} rx={topR} ry={topR * K} fill={OR} opacity={0.5} stroke={OR} strokeWidth={4} /> : null}
          {wire(cup.front, 2.6, 0.95)}

          {/* Pour: a line and a particle train */}
          {s.streaming ? (
            <>
              <path d={flow} stroke={OR} strokeWidth={3} opacity={0.75} fill="none" />
              <path d={flow} stroke="#ffe7b0" strokeWidth={14} strokeLinecap="round" fill="none" strokeDasharray="1 34" strokeDashoffset={-f * 16} />
            </>
          ) : null}

          {/* Kettle */}
          <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
            {wire(body.back + lid.back + spout.back + handle.back, 1.6, 0.34)}
            {wire(body.front + lid.front + spout.front + handle.front, 2.6, 0.95)}
            <circle cx={0} cy={-129} r={18} fill="none" stroke={CY} strokeWidth={3} />
          </g>

          {/* Steam */}
          {s.steam.map((p, i) =>
            p > 0 ? (
              <path key={i} d={steamPath(i, p, f * 0.06)} fill="none" stroke={CY} strokeWidth={4} strokeLinecap="round" strokeDasharray="10 18" strokeDashoffset={f * 3} opacity={0.9} />
            ) : null,
          )}

          {/* Corner brackets */}
          {[[44, 44, 1, 1], [W - 44, 44, -1, 1], [44, H - 44, 1, -1], [W - 44, H - 44, -1, -1]].map(([x, y, a, b], i) => (
            <path key={i} d={`M${x + a * 90},${y} L${x},${y} L${x},${y + b * 90}`} fill="none" stroke={CY} strokeWidth={4} />
          ))}

          {/* Sequence strip */}
          <path d={`M90,92 L${W - 90},92`} stroke={DIM} strokeWidth={2} />
          {Array.from({ length: 46 }).map((_, i) => (
            <path key={i} d={`M${90 + i * 20},92 L${90 + i * 20},${i % 5 === 0 ? 108 : 100}`} stroke={DIM} strokeWidth={2} />
          ))}
          {STEPS.map(([t, a, b], i) => {
            const on = f >= a && f < b;
            const done = f >= b;
            const x = 150 + i * 230;
            return (
              <g key={t}>
                <rect x={x - 6} y={124} width={186} height={48} fill={on ? OR : "none"} opacity={on ? 0.85 : 1} stroke={on ? OR : done ? CY : DIM} strokeWidth={2} />
                <Txt x={x + 87} y={160} s={34} a="middle" c={on ? "#031018" : done ? CY : DIM}>{t}</Txt>
              </g>
            );
          })}

          {/* Spout tracker */}
          {s.kx < 1000 ? (
            <g transform={`translate(${s.tip.x} ${s.tip.y})`}>
              <circle r={46} fill="none" stroke={OR} strokeWidth={2.5} strokeDasharray="20 12" strokeDashoffset={f * 2} />
              <path d="M-66,0 L-48,0 M48,0 L66,0 M0,-66 L0,-48 M0,48 L0,66" stroke={OR} strokeWidth={2.5} />
              <path d="M-40,34 L-130,120 L-280,120" fill="none" stroke={OR} strokeWidth={2} />
              <Txt x={-280} y={108} s={36} c={OR}>{s.streaming ? "POUR" : "KETTLE"}</Txt>
            </g>
          ) : null}

          {/* Cup level ruler */}
          <path d="M770,800 L770,1060" stroke={CY} strokeWidth={3} />
          {Array.from({ length: 14 }).map((_, i) => (
            <path key={i} d={`M770,${800 + i * 20} L${i % 2 ? 788 : 800},${800 + i * 20}`} stroke={CY} strokeWidth={2} />
          ))}
          <g transform={`translate(770 ${yFill})`}>
            <path d="M0,0 L-30,-14 L-30,14 Z" fill={OR} />
            <path d="M-30,0 L-90,0" stroke={OR} strokeWidth={2} />
          </g>
          <Txt x={812} y={yFill + 12} s={34} c={OR}>{`${Math.round(s.level * 100)}%`}</Txt>

          {/* Radial gauge */}
          <circle cx={arcC.x} cy={arcC.y} r={arcR} fill="none" stroke={DIM} strokeWidth={12} />
          {arcPath ? <path d={arcPath} fill="none" stroke={OR} strokeWidth={12} /> : null}
          <circle cx={arcC.x} cy={arcC.y} r={arcR + 22} fill="none" stroke={CY} strokeWidth={2} strokeDasharray="4 16" transform={`rotate(${f * 1.4} ${arcC.x} ${arcC.y})`} />
          <circle cx={arcC.x} cy={arcC.y} r={arcR - 22} fill="none" stroke={CY} strokeWidth={2} strokeDasharray="44 22" transform={`rotate(${-f * 1.1} ${arcC.x} ${arcC.y})`} />
          <Txt x={arcC.x} y={arcC.y + 18} s={54} a="middle">{Math.round(s.level * 100)}</Txt>
          <Txt x={350} y={1188} s={30}>CUP</Txt>
          <Txt x={350} y={1222} s={30}>LEVEL</Txt>

          {/* Level trace */}
          <rect x={gx} y={gy} width={gw} height={gh} fill="none" stroke={DIM} strokeWidth={2} />
          {[0.25, 0.5, 0.75].map((v) => (
            <path key={v} d={`M${gx},${gy + v * gh} L${gx + gw},${gy + v * gh}`} stroke={DIM} strokeWidth={1.2} opacity={0.6} />
          ))}
          <path d={trace} fill="none" stroke={OR} strokeWidth={4} />
          <Txt x={gx} y={gy - 12} s={28} c={DIM}>FILL</Txt>
          {f >= 104 && Math.floor(f / 8) % 2 === 0 ? <Txt x={gx + gw} y={gy - 12} s={34} a="end" c={OR}>HOT</Txt> : null}
        </g>

        <rect width={W} height={H} fill="url(#hu-scan)" />
      </svg>
    </div>
  );
};
