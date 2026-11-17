import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Rough, Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { Pt, pts, ribbon, rng, spiral } from "./util";

const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---------- 33 Ukiyo-e: bokashi sky, sumi keyline, carved repeat patterns, baren marks ---------- */
const UK = { sumi: "#1d1a17", indigo: "#20406b", deep: "#172f52", ver: "#c6452c", rose: "#e7a79a", ochre: "#d7ad63", cream: "#efe2c5", iron: "#34383c", tan: "#b9824a", sage: "#71906f" };

const UK_MIST = [
  "M-20,560 H250 q22,0 22,-22 q0,-22 22,-22 H520 q24,0 24,24 q0,24 -24,24 H440 q-22,0 -22,22 q0,22 22,22 H-20 Z",
  "M1100,380 H820 q-22,0 -22,22 q0,22 -22,22 H640 q-24,0 -24,24 q0,24 24,24 H820 q22,0 22,22 q0,22 22,22 H1100 Z",
  "M-20,760 H150 q20,0 20,-20 q0,-20 20,-20 H330 q22,0 22,22 q0,22 -22,22 H250 q-20,0 -20,20 q0,20 20,20 H-20 Z",
  "M1100,720 H900 q-20,0 -20,20 q0,20 -20,20 H770 q-22,0 -22,22 q0,22 22,22 H1100 Z",
];

const UK_BLOSSOMS: [number, number, number][] = [
  [212, 128, 30], [298, 196, 26], [132, 214, 24], [388, 118, 24], [84, 322, 26], [232, 278, 22], [468, 170, 20],
];

const Blossom: React.FC<{ x: number; y: number; r: number }> = ({ x, y, r }) => (
  <g transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((a) => (
      <ellipse key={a} cx={0} cy={-r * 0.62} rx={r * 0.44} ry={r * 0.62} fill="#f3cfc6" stroke={UK.sumi} strokeWidth={2.5} transform={`rotate(${a})`} />
    ))}
    <circle r={r * 0.2} fill={UK.ver} />
  </g>
);

const curlHead = (line: Pt[], i: number) => {
  const e = line[line.length - 1];
  const b = line[Math.max(0, line.length - 3)];
  const dir = i === 1 ? -1 : 1;
  const a = Math.atan2(e.y - b.y, e.x - b.x);
  const cx = e.x + Math.cos(a + (dir * Math.PI) / 2) * 34;
  const cy = e.y + Math.sin(a + (dir * Math.PI) / 2) * 34;
  return spiral(cx, cy, 34, 1.5, a - (dir * Math.PI) / 2, dir);
};

export const Ukiyoe: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const seed = (Math.floor(sf / 3) % 3) + 1;
  const ink = { fill: "none", stroke: UK.sumi, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <Stage bg={UK.cream} defs={
      <>
        <linearGradient id="uk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={UK.deep} />
          <stop offset="0.16" stopColor={UK.indigo} />
          <stop offset="0.36" stopColor="#8fa8b4" stopOpacity={0.55} />
          <stop offset="0.52" stopColor={UK.cream} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="uk-dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={UK.rose} stopOpacity={0} />
          <stop offset="1" stopColor={UK.rose} stopOpacity={0.85} />
        </linearGradient>
        <linearGradient id="uk-cup" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d9633f" />
          <stop offset="0.7" stopColor={UK.ver} />
          <stop offset="1" stopColor="#8f2c1c" />
        </linearGradient>
        <linearGradient id="uk-iron" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#59605f" />
          <stop offset="0.6" stopColor={UK.iron} />
          <stop offset="1" stopColor="#1e2124" />
        </linearGradient>
        <pattern id="uk-sei" width={92} height={46} patternUnits="userSpaceOnUse">
          <rect width={92} height={46} fill={UK.indigo} />
          {[[0, 46], [92, 46], [46, 23], [0, 0], [92, 0]].map(([cx, cy], i) => (
            <g key={i} fill={UK.indigo} stroke={UK.cream} strokeWidth={2.6}>
              <circle cx={cx} cy={cy} r={46} />
              <circle cx={cx} cy={cy} r={33} />
              <circle cx={cx} cy={cy} r={20} />
              <circle cx={cx} cy={cy} r={8} />
            </g>
          ))}
        </pattern>
        <pattern id="uk-arare" width={34} height={34} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <circle cx={9} cy={9} r={9} fill="#1a1c1e" />
          <circle cx={7} cy={7} r={5.5} fill="#7e8785" />
        </pattern>
        <pattern id="uk-asa" width={60} height={104} patternUnits="userSpaceOnUse">
          <rect width={60} height={104} fill={UK.ochre} />
          <path d="M0,0 L60,104 M60,0 L0,104 M30,0 V104 M0,52 H60 M0,0 L30,52 L60,0 M0,104 L30,52 L60,104" stroke={UK.sumi} strokeWidth={2.2} fill="none" />
        </pattern>
        <filter id="uk-grain" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.16" numOctaves={3} seed={11} />
          <feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.11  0 0 0 0 0.07  0 0 0 1.2 -0.5" />
        </filter>
        <filter id="uk-paper" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={3} />
          <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0 0.14  0 0 0 0.7 -0.3" />
        </filter>
        <Rough id="uk-line" seed={seed} freq={0.018} scale={3.5} />
        <clipPath id="uk-rim"><path d={P.rim} /></clipPath>
        <clipPath id="uk-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="uk-ket"><path d={P.kettleBody} /></clipPath>
      </>
    }>
      <rect width={W} height={700} fill="url(#uk-sky)" />
      <rect y={500} width={W} height={470} fill="url(#uk-dusk)" />
      {UK_MIST.map((d, i) => (
        <g key={i} filter="url(#uk-line)">
          <path d={d} fill={UK.cream} opacity={i < 2 ? 0.96 : 0.9} />
          <path d={d} {...ink} strokeWidth={2.5} opacity={0.6} />
        </g>
      ))}

      {/* A branch across the corner, as a printed foreground */}
      <g filter="url(#uk-line)">
        <path d="M-20,250 C70,190 150,180 250,120 C320,78 380,70 470,40" {...ink} strokeWidth={22} />
        <path d="M130,178 C150,220 120,290 80,330" {...ink} strokeWidth={13} />
        <path d="M250,120 C280,160 330,160 400,120" {...ink} strokeWidth={10} />
        {UK_BLOSSOMS.map(([x, y, r], i) => <Blossom key={i} x={x} y={y} r={r} />)}
      </g>

      {/* Floor boards, then a patterned mat */}
      <rect y={960} width={W} height={400} fill={UK.tan} />
      <g stroke={UK.sumi} strokeWidth={3} opacity={0.75}>
        {[-400, -200, 0, 200, 400, 600, 800, 1000, 1200, 1400, 1600].map((x, i) => (
          <line key={i} x1={540 + (x - 540) * 0.45} y1={960} x2={x} y2={H} />
        ))}
      </g>
      <path d="M0,960 H1080" stroke={UK.sumi} strokeWidth={6} />
      <path d="M210,1010 H870 L960,1230 H120 Z" fill="url(#uk-sei)" />
      <g filter="url(#uk-line)">
        <path d="M210,1010 H870 L960,1230 H120 Z" {...ink} strokeWidth={7} />
        <path d="M194,1050 H886 M160,1190 H920" stroke={UK.ver} strokeWidth={16} fill="none" />
      </g>

      {/* Cup */}
      <path d={P.kulhadBody} fill="url(#uk-cup)" />
      <g clipPath="url(#uk-body)">
        <rect x={360} y={906} width={360} height={82} fill="url(#uk-asa)" />
        <path d="M360,906 H720 M360,988 H720" stroke={UK.sumi} strokeWidth={5} />
      </g>
      <path d={P.rim} fill="#3f2418" />
      <g clipPath="url(#uk-rim)">
        {s.level > 0 ? (
          <>
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={UK.ochre} />
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.74} ry={s.surface.ry * 0.74} fill="none" stroke={UK.sumi} strokeWidth={2.5} />
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.45} ry={s.surface.ry * 0.45} fill="none" stroke={UK.sumi} strokeWidth={2.5} />
          </>
        ) : null}
      </g>
      <g filter="url(#uk-line)">
        <path d={P.kulhadOutline} {...ink} strokeWidth={8} />
        <path d={P.rim} {...ink} strokeWidth={7} />
      </g>

      {/* Pour, drawn like falling water: parallel keyed lines */}
      {s.streaming ? (
        <g filter="url(#uk-line)">
          <path d={s.stream} fill="none" stroke={UK.sumi} strokeWidth={36} strokeLinecap="round" />
          <path d={s.stream} fill="none" stroke={UK.ochre} strokeWidth={26} strokeLinecap="round" />
          {[-6, 0, 7].map((o, i) => (
            <path key={i} d={s.stream} fill="none" stroke={i === 1 ? UK.cream : UK.sumi} strokeWidth={i === 1 ? 4 : 2.6}
              strokeDasharray={`${54 + i * 12} ${22 + i * 8}`} strokeDashoffset={-sf * 7 + i * 30} transform={`translate(${o} 0)`} />
          ))}
        </g>
      ) : null}

      {/* Tetsubin kettle */}
      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d={P.kettleHandle} fill="none" stroke={UK.sumi} strokeWidth={30} strokeLinecap="round" />
        <path d={P.kettleHandle} fill="none" stroke={UK.ver} strokeWidth={15} strokeLinecap="round" />
        <path d={P.kettleSpout} fill="url(#uk-iron)" />
        <path d={P.kettleBody} fill="url(#uk-iron)" />
        <g clipPath="url(#uk-ket)">
          <rect x={-180} y={-110} width={360} height={154} fill="url(#uk-arare)" opacity={0.95} />
        </g>
        <path d={P.kettleBand} fill="none" stroke={UK.sumi} strokeWidth={34} />
        <path d={P.kettleBand} fill="none" stroke={UK.ochre} strokeWidth={22} />
        <path d={P.kettleLid} fill={UK.sumi} />
        <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 3} fill={UK.ver} stroke={UK.sumi} strokeWidth={6} />
        <g filter="url(#uk-line)">
          <path d={P.kettleBody} {...ink} strokeWidth={8} />
          <path d={P.kettleSpout} {...ink} strokeWidth={7} />
          <path d={P.kettleLid} {...ink} strokeWidth={7} />
        </g>
      </g>

      {/* Steam as curled cloud-scrolls */}
      {s.steam.map((p, i) => {
        if (p <= 0) return null;
        const line = pts(steamPath(i, p, sf * 0.05));
        const head = p > 0.25 ? curlHead(line, i) : "";
        return (
          <g key={i} filter="url(#uk-line)">
            <path d={ribbon(line, 34, 18)} fill={UK.cream} stroke={UK.sumi} strokeWidth={5} strokeLinejoin="round" />
            {head ? <path d={head} fill="none" stroke={UK.sumi} strokeWidth={19} strokeLinecap="round" /> : null}
            {head ? <path d={head} fill="none" stroke={UK.cream} strokeWidth={9} strokeLinecap="round" /> : null}
          </g>
        );
      })}

      {/* Red seal, a kettle mark rather than any lettering */}
      <g transform="translate(92 906)">
        <rect x={-40} y={-52} width={80} height={104} rx={9} fill={UK.ver} />
        <path d="M-16,-12 Q0,-30 16,-12 M-22,-8 H22 L14,26 H-14 Z M0,-22 V-34" fill="none" stroke={UK.cream} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
      </g>

      <rect width={W} height={H} filter="url(#uk-grain)" opacity={0.3} style={{ mixBlendMode: "multiply" }} />
      <rect width={W} height={H} filter="url(#uk-paper)" opacity={0.42} style={{ mixBlendMode: "multiply" }} />
      <rect x={0} y={0} width={W} height={H} fill="none" stroke={UK.cream} strokeWidth={44} />
      <rect x={22} y={22} width={W - 44} height={H - 44} fill="none" stroke={UK.sumi} strokeWidth={6} />
    </Stage>
  );
};

/* ---------- 34 Art deco: gold on black, strict symmetry, stepped arches and sunburst fans ---------- */
const DC = { black: "#0a0d12", emerald: "#0d3a3a", ivory: "#efe6cc", gold: "#d7ae57" };

const fan = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => {
  const p = (a: number, r: number) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(a0, r0)} L${p(a0, r1)} L${p(a1, r1)} L${p(a1, r0)} Z `;
};

const DC_RAYS = Array.from({ length: 31 }, (_, i) => {
  const t = i / 30;
  const a = Math.PI + t * Math.PI;
  const w = (Math.PI / 30) * 0.28;
  return { t, d: fan(540, 800, 150, 720 - Math.abs(t - 0.5) * 300 + (i % 2 ? -70 : 0), a - w, a + w) };
});

const DC_STEPS = "M90,1270 V360 H150 V280 H230 V200 H330 V130 H750 V200 H850 V280 H930 V360 H990 V1270 Z";
const DC_STEPS_IN = "M122,1238 V392 H182 V312 H262 V232 H362 V162 H718 V232 H818 V312 H898 V392 H958 V1238 Z";

const DC_FLUTES = Array.from({ length: 13 }, (_, i) => i);

// Frozen-fountain steam: mirrored curves on the poster's axis.
const fountain = (p: number, side: number, spread: number, lift: number) => {
  const n = 28;
  let d = "";
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * p;
    const x = 540 + side * (34 + spread * t * 0.62 + Math.sin(t * 6.1) * 30 * (0.45 + t));
    const y = 772 - lift * t;
    d += `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d;
};

export const ArtDeco: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const glow = interpolate(s.level, [0, 1], [0, 1], cl);
  const shimmer = (Math.sin(f * 0.09) + 1) / 2;
  const stops = (id: string, x1: number, y1: number, x2: number, y2: number) => (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" stopColor="#7c5a1e" />
      <stop offset={0.18 + shimmer * 0.1} stopColor="#f7e6a8" />
      <stop offset="0.42" stopColor="#c3913c" />
      <stop offset={0.62 + shimmer * 0.1} stopColor="#fbeeb9" />
      <stop offset="1" stopColor="#6d4c18" />
    </linearGradient>
  );
  const gold = "url(#dc-gold)";
    return (
    <Stage bg={DC.black} defs={
      <>
        {stops("dc-gold", 0, 0, 1, 1)}
        {stops("dc-goldh", 0, 0, 1, 0)}
        <radialGradient id="dc-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f6dc94" stopOpacity={0.55} />
          <stop offset="1" stopColor="#f6dc94" stopOpacity={0} />
        </radialGradient>
        <clipPath id="dc-arch"><path d={DC_STEPS_IN} /></clipPath>
        <clipPath id="dc-cup"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="dc-rim"><path d={P.rim} /></clipPath>
        <clipPath id="dc-ket"><path d={P.kettleBody} /></clipPath>
      </>
    }>
      {/* Stepped frame */}
      <path d={DC_STEPS} fill="none" stroke={gold} strokeWidth={10} />
      <path d={DC_STEPS_IN} fill={DC.emerald} stroke={gold} strokeWidth={4} />
      {[34, 50].map((m, i) => (
        <rect key={i} x={m} y={m} width={W - m * 2} height={H - m * 2} fill="none" stroke={gold} strokeWidth={i ? 2 : 5} />
      ))}
      {[[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]].map(([x, y], i) => (
        <path key={i} d={`M${x},${y} m-26,0 l26,-26 l26,26 l-26,26 Z`} fill={gold} />
      ))}

      <g clipPath="url(#dc-arch)">
        {/* The fan opens as the cup fills */}
        {DC_RAYS.map((r, i) => {
          const open = interpolate(glow, [0.5 * Math.abs(r.t - 0.5), 0.5 * Math.abs(r.t - 0.5) + 0.42], [0.42, 1], cl);
          return (
            <path key={i} d={r.d} fill={i % 2 ? "url(#dc-goldh)" : DC.ivory} opacity={i % 2 ? 0.95 : 0.2 + 0.2 * glow}
              transform={`translate(540 800) scale(${open}) translate(-540 -800)`} />
          );
        })}
        <ellipse cx={540} cy={810} rx={330 + 110 * glow} ry={260 + 90 * glow} fill="url(#dc-glow)" opacity={glow} />
        {/* Chevron plinth, centred */}
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <path key={k} d={`M122,${1130 + k * 26} L540,${1076 + k * 26} L958,${1130 + k * 26}`} fill="none" stroke={k % 2 ? gold : DC.ivory} strokeWidth={k % 2 ? 10 : 3} />
        ))}
              </g>
      <path d="M260,1072 H820" stroke="#d7ae57" strokeWidth={8} />

      {/* Fluted cup */}
      <path d={P.kulhadBody} fill={DC.black} />
      <g clipPath="url(#dc-cup)">
        {DC_FLUTES.map((i) => {
          const u = i / 12;
          const x = 360 + u * 360;
          const w = 30;
          const fx = 540 + (x - 540) * 0.72;
          return <path key={i} d={`M${x - w * 0.44},790 L${x + w * 0.44},790 L${fx + w * 0.3},1080 L${fx - w * 0.3},1080 Z`} fill={i % 2 ? gold : DC.ivory} opacity={i % 2 ? 1 : 0.24} />;
        })}
        <path d="M360,900 Q540,962 720,900 M360,926 Q540,988 720,926" fill="none" stroke={DC.black} strokeWidth={10} />
      </g>
      <path d={P.kulhadOutline} fill="none" stroke={gold} strokeWidth={9} strokeLinejoin="round" />
      <path d={P.rim} fill={DC.black} stroke={gold} strokeWidth={9} />
      <g clipPath="url(#dc-rim)">
        {s.level > 0 ? (
          <>
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#a9642c" />
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.8} ry={s.surface.ry * 0.74} fill="none" stroke="#f3dc9a" strokeWidth={3} />
            <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.5} ry={s.surface.ry * 0.46} fill="none" stroke="#f3dc9a" strokeWidth={3} />
          </>
        ) : null}
      </g>

      {/* Pour: a gold-edged column */}
      {s.streaming ? (
        <>
          <path d={s.stream} fill="none" stroke={gold} strokeWidth={30} strokeLinecap="butt" />
          <path d={s.stream} fill="none" stroke="#a9642c" strokeWidth={19} strokeLinecap="butt" />
          <path d={s.stream} fill="none" stroke="#f3dc9a" strokeWidth={3} strokeLinecap="butt" />
        </>
      ) : null}

      {/* Streamlined kettle with vertical fluting */}
      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d={P.kettleHandle} fill="none" stroke={gold} strokeWidth={24} strokeLinecap="square" />
        <path d={P.kettleHandle} fill="none" stroke={DC.black} strokeWidth={8} />
        <path d={P.kettleSpout} fill={gold} />
        <path d={P.kettleBody} fill={DC.black} />
        <g clipPath="url(#dc-ket)">
          {Array.from({ length: 11 }, (_, i) => (
            <rect key={i} x={-176 + i * 32} y={-120} width={18} height={280} fill={gold} opacity={i === 2 || i === 3 ? 1 : 0.74} />
          ))}
          <rect x={-180} y={38} width={360} height={36} fill={DC.black} />
          {[-1, 0, 1].map((k) => <path key={k} d={`M${k * 60 - 22},56 l22,-14 l22,14 l-22,14 Z`} fill={gold} />)}
        </g>
        <path d={P.kettleBody} fill="none" stroke={gold} strokeWidth={8} strokeLinejoin="round" />
        <path d={P.kettleLid} fill={gold} stroke={DC.black} strokeWidth={3} />
        <path d={`M${KNOB.x},${KNOB.y - 25} l20,25 l-20,25 l-20,-25 Z`} fill={gold} stroke={DC.black} strokeWidth={3} />
      </g>

      {/* Frozen-fountain steam on the centre axis */}
      {s.steam[1] > 0 ? (
        <g>
          <path d={`M540,772 V${772 - 396 * s.steam[1]}`} stroke={DC.black} strokeWidth={20} />
          <path d={`M540,772 V${772 - 396 * s.steam[1]}`} stroke="#ecca7a" strokeWidth={8} />
          <path d={`M540,${772 - 396 * s.steam[1] - 30} l18,30 l-18,30 l-18,-30 Z`} fill="#f7e6a8" stroke={DC.black} strokeWidth={4} />
        </g>
      ) : null}
      {[{ i: 0, spread: 150, lift: 330 }, { i: 2, spread: 86, lift: 372 }].map(({ i, spread, lift }) =>
        s.steam[i] > 0
          ? [-1, 1].map((side) => {
              const d = fountain(s.steam[i], side, spread, lift);
              const inner = fountain(s.steam[i], side, spread - 15, lift - 12);
              return (
                <g key={`${i}${side}`} fill="none" strokeLinecap="round">
                  <path d={d} stroke={DC.black} strokeWidth={17} />
                  <path d={d} stroke="#ecca7a" strokeWidth={7} />
                  <path d={inner} stroke="#f7e6a8" strokeWidth={2.5} opacity={0.9} />
                </g>
              );
            })
          : null,
      )}
    </Stage>
  );
};

/* ---------- 35 Stained glass: light through coloured panes, held in lead came ---------- */
type Pane = { d: string; c: string; ph: number; pts: Pt[] };

const GL_GOLD = ["#f4b63a", "#f09a2a", "#f8cf5f"];
const GL_BLUE = ["#1d4fb8", "#2c6fd6", "#143a93", "#3987e4"];
const GL_RED = ["#c1252e", "#9c1c31", "#d93a35"];
const GL_GREEN = ["#1f8a57", "#14704f"];
const GL_VIOLET = ["#6b3bb0", "#4d2c94"];

const GL_PANES: Pane[] = (() => {
  const r = rng(3501);
  const cx = 540;
  const cy = 800;
  const out: Pane[] = [];
  const rings = [0, 180, 300, 430, 570, 720, 880, 1060];
  rings.slice(0, -1).forEach((r0, ri) => {
    const r1 = rings[ri + 1];
    const n = 10 + ri * 3;
    const off = ri % 2 ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const j = () => (r() - 0.5) * 18;
      const a0 = ((i + off) / n) * Math.PI * 2;
      const a1 = ((i + 1 + off) / n) * Math.PI * 2;
      const P0 = [
        { x: cx + Math.cos(a0) * r0 + j(), y: cy + Math.sin(a0) * r0 + j() },
        { x: cx + Math.cos(a1) * r0 + j(), y: cy + Math.sin(a1) * r0 + j() },
        { x: cx + Math.cos(a1) * r1 + j(), y: cy + Math.sin(a1) * r1 + j() },
        { x: cx + Math.cos(a0) * r1 + j(), y: cy + Math.sin(a0) * r1 + j() },
      ];
      const mid = (a0 + a1) / 2;
      const up = -Math.sin(mid);
      const pick = r();
      let pal = GL_BLUE;
      if (ri === 0) pal = GL_GOLD;
      else if (ri === 1) pal = pick < 0.6 ? GL_GOLD : GL_RED;
      else if (up < -0.25) pal = pick < 0.5 ? GL_GREEN : GL_RED;
      else if (pick < 0.16) pal = GL_RED;
      else if (pick < 0.3) pal = GL_VIOLET;
      else if (pick < 0.36) pal = GL_GOLD;
      out.push({
        d: `M${P0.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")} Z`,
        c: pal[Math.floor(r() * pal.length)],
        ph: r() * 6.28,
        pts: P0,
      });
    }
  });
  return out;
})();

const GL_ARCH = "M120,1300 V520 C120,250 340,110 540,50 C740,110 960,250 960,520 V1300 Z";
const GL_LEAD = GL_PANES.map((p) => p.d).join(" ");

// Split a local outline into glass shards with straight leading.
const KET_SHARDS = [
  { d: "M-180,-120 L-40,-120 L-74,20 L-180,20 Z", c: "#57a6c9" },
  { d: "M-40,-120 L60,-120 L76,20 L-74,20 Z", c: "#8cc9dd" },
  { d: "M60,-120 L180,-120 L180,20 L76,20 Z", c: "#2f7ea6" },
  { d: "M-180,20 L-74,20 L-30,160 L-180,160 Z", c: "#2f7ea6" },
  { d: "M-74,20 L76,20 L44,160 L-30,160 Z", c: "#57a6c9" },
  { d: "M76,20 L180,20 L180,160 L44,160 Z", c: "#1c5d85" },
];
const CUP_SHARDS = [
  { d: "M360,780 L470,780 L482,930 L360,930 Z", c: "#d4602f" },
  { d: "M470,780 L600,780 L588,930 L482,930 Z", c: "#ed8240" },
  { d: "M600,780 L720,780 L720,930 L588,930 Z", c: "#a73f1e" },
  { d: "M360,930 L482,930 L502,1090 L360,1090 Z", c: "#a73f1e" },
  { d: "M482,930 L588,930 L568,1090 L502,1090 Z", c: "#d4602f" },
  { d: "M588,930 L720,930 L720,1090 L568,1090 Z", c: "#7f2c15" },
];

const Came: React.FC<{ d: string; w: number }> = ({ d, w }) => (
  <>
    <path d={d} fill="none" stroke="#101014" strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" />
    <path d={d} fill="none" stroke="#50505c" strokeWidth={w * 0.2} strokeLinejoin="round" strokeLinecap="round" />
  </>
);

export const StainedGlass: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const lx = interpolate(f, [0, 150], [260, 800]);
  const ly = interpolate(f, [0, 150], [220, 460]);
  const body = "url(#gl-body)";
  return (
    <Stage bg="#14110f" defs={
      <>
        <clipPath id="gl-arch"><path d={GL_ARCH} /></clipPath>
        <clipPath id="gl-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="gl-rim"><path d={P.rim} /></clipPath>
        <clipPath id="gl-ket"><path d={P.kettleBody} /></clipPath>
        <radialGradient id="gl-light" gradientUnits="userSpaceOnUse" cx={lx} cy={ly} r={900}>
          <stop offset="0" stopColor="#fff6d8" stopOpacity={0.5} />
          <stop offset="0.45" stopColor="#fff6d8" stopOpacity={0.05} />
          <stop offset="1" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <radialGradient id="gl-sun" gradientUnits="userSpaceOnUse" cx={lx} cy={ly} r={520}>
          <stop offset="0" stopColor="#fff2c4" stopOpacity={0.5} />
          <stop offset="1" stopColor="#fff2c4" stopOpacity={0} />
        </radialGradient>
        <filter id="gl-mottle" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves={4} seed={8} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.7" />
        </filter>
        <filter id="gl-seed" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.25} numOctaves={2} seed={21} />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.5 -2.1" />
        </filter>
        <filter id="gl-bloom" {...region}>
          <feGaussianBlur stdDeviation={26} />
        </filter>
        <filter id="gl-wall" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.009" numOctaves={3} seed={2} />
          <feColorMatrix values="0 0 0 0 0.11  0 0 0 0 0.09  0 0 0 0 0.08  0 0 0 0.5 -0.12" />
        </filter>
      </>
    }>
      <rect width={W} height={H} filter="url(#gl-wall)" />
      {/* Bloom spilling past the leading */}
      <g opacity={0.75} filter="url(#gl-bloom)">
        <g clipPath="url(#gl-arch)">
          {GL_PANES.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}
        </g>
      </g>

      <g clipPath="url(#gl-arch)">
        {GL_PANES.map((p, i) => (
          <path key={i} d={p.d} fill={p.c} opacity={0.86 + 0.14 * Math.sin(f * 0.07 + p.ph)} />
        ))}
        <rect width={W} height={H} filter="url(#gl-mottle)" opacity={0.42} style={{ mixBlendMode: "multiply" }} />
        <rect width={W} height={H} filter="url(#gl-seed)" opacity={0.25} style={{ mixBlendMode: "screen" }} />
        <rect width={W} height={H} fill="url(#gl-light)" style={{ mixBlendMode: "overlay" }} />
        <rect width={W} height={H} fill="url(#gl-sun)" style={{ mixBlendMode: "screen" }} />
        <Came d={GL_LEAD} w={9} />

        {/* Cup: glass shards, and the glass warms from below as it fills */}
        <g clipPath={body}>
          {CUP_SHARDS.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}
          <rect x={360} y={1076 - 276 * s.level} width={360} height={290} fill="#ffc84a" opacity={0.74} style={{ mixBlendMode: "screen" }} />
          <Came d={CUP_SHARDS.map((p) => p.d).join(" ")} w={8} />
        </g>
        <path d={P.rim} fill="#2a130a" />
        <g clipPath="url(#gl-rim)">
          {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill="#f6ab2f" /> : null}
          {s.level > 0 ? <ellipse cx={s.surface.cx - 40} cy={s.surface.cy - 6} rx={s.surface.rx * 0.4} ry={s.surface.ry * 0.4} fill="#ffe08f" /> : null}
        </g>
        <Came d={P.kulhadBody} w={13} />
        <Came d={P.rim} w={12} />

        {s.streaming ? (
          <>
            <path d={s.stream} fill="none" stroke="#101014" strokeWidth={38} strokeLinecap="butt" />
            <path d={s.stream} fill="none" stroke="#f6ab2f" strokeWidth={24} strokeLinecap="butt" />
            <path d={s.stream} fill="none" stroke="#ffe08f" strokeWidth={7} strokeLinecap="butt" transform="translate(-4 0)" />
            <path d={s.stream} fill="none" stroke="#101014" strokeWidth={6} strokeDasharray="4 74" strokeDashoffset={-sf * 6} />
          </>
        ) : null}

        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={P.kettleHandle} fill="none" stroke="#101014" strokeWidth={40} strokeLinecap="round" />
          <path d={P.kettleHandle} fill="none" stroke="#f4b63a" strokeWidth={22} strokeLinecap="round" />
          <path d={P.kettleSpout} fill="#57a6c9" stroke="#101014" strokeWidth={12} strokeLinejoin="round" />
          <g clipPath="url(#gl-ket)">
            {KET_SHARDS.map((p, i) => <path key={i} d={p.d} fill={p.c} />)}
            <Came d={KET_SHARDS.map((p) => p.d).join(" ")} w={8} />
          </g>
          <Came d={P.kettleBody} w={13} />
          <path d={P.kettleLid} fill="#c1252e" stroke="#101014" strokeWidth={11} strokeLinejoin="round" />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 4} fill="#f4b63a" stroke="#101014" strokeWidth={10} />
        </g>

        {s.steam.map((p, i) => {
          if (p <= 0) return null;
          const d = steamPath(i, p, sf * 0.05);
          return (
            <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={d} stroke="#101014" strokeWidth={36} />
              <path d={d} stroke="#e9f3f6" strokeWidth={22} />
              <path d={d} stroke="#101014" strokeWidth={5} strokeDasharray="3 62" />
            </g>
          );
        })}
      </g>
      <path d={GL_ARCH} fill="none" stroke="#0b0b0e" strokeWidth={30} />
      <path d={GL_ARCH} fill="none" stroke="#5a4e3f" strokeWidth={5} />
          </Stage>
  );
};
