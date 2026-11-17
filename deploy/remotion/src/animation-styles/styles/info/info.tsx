import { loadFont as loadLilita } from "@remotion/google-fonts/LilitaOne";
import { loadFont as loadStix } from "@remotion/google-fonts/STIXTwoText";
import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Paper, Stage, region } from "../../kit";
import { DUR, H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { cl, pourD, pourSeg, rnd } from "./shared";

const { fontFamily: LILITA } = loadLilita("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: STIX } = loadStix("italic", { weights: ["400"], subsets: ["latin", "greek"] });
const ease = Easing.inOut(Easing.cubic);

/* ---------- 51 Sticker explainer: die-cut vinyl slapped onto a blue lid ---------- */
const slap = (f: number, t0: number) => {
  const p = f - t0;
  if (p < 0) return null;
  return {
    s: interpolate(p, [0, 2, 4, 8], [1.9, 0.9, 1.06, 1], cl),
    r: interpolate(p, [0, 2, 4, 8], [12, -5, 2, 0], cl),
  };
};

const S_INK = "#231613";
const WordSticker: React.FC<{ x: number; y: number; t0: number; f: number; rot0: number; text: string; fill: string; size: number }> = ({ x, y, t0, f, rot0, text, fill, size }) => {
  const a = slap(f, t0);
  if (!a) return null;
  return (
    <g filter="url(#st-sh)">
      <g transform={`translate(${x} ${y}) rotate(${rot0 + a.r}) scale(${a.s})`}>
        <text textAnchor="middle" fontFamily={LILITA} fontSize={size} stroke="#fff" strokeWidth={size * 0.3} strokeLinejoin="round" fill="#fff" y={size * 0.34}>{text}</text>
        <text textAnchor="middle" fontFamily={LILITA} fontSize={size} stroke={S_INK} strokeWidth={size * 0.09} strokeLinejoin="round" paintOrder="stroke" fill={fill} y={size * 0.34}>{text}</text>
      </g>
    </g>
  );
};

const burst = (r0: number, r1: number, n: number) => {
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? r0 : r1;
    d += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)} `;
  }
  return `${d}Z`;
};

export const StickerExplainer: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(Math.floor(f / 4) * 4);
  const live = storyAt(sf);
  const j = (a: number) => (rnd(Math.floor(sf / 4) + a) - 0.5) * 2.4;
  const kettleLand = slap(f, 20);
  const kScale = kettleLand ? interpolate(f - 20, [0, 2, 5], [1.12, 0.96, 1], cl) : 1;
  const stepLevel = Math.floor(live.level * 7 + 0.0001) / 7;
  const yFill = 1050 - 232 * stepLevel;
  const wave = (a: number) => {
    let d = `M340,1100 L340,${yFill + a}`;
    for (let x = 340; x <= 740; x += 30) d += ` Q${x + 15},${yFill + a + (Math.floor(x / 30) % 2 ? -18 : 18)} ${x + 30},${yFill + a}`;
    return `${d} L740,1100 Z`;
  };
  const steamCols = ["#BDE7FF", "#FFD3E8", "#FFF2B0"];
  const pour = live.streaming;
  const white = { fill: "none", stroke: "#fff", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <Stage bg="#2342E2" defs={
      <>
        <filter id="st-sh" {...region}><feDropShadow dx={5} dy={9} stdDeviation={5} floodColor="#0a1660" floodOpacity={0.55} /></filter>
        <clipPath id="st-body"><path d="M384,822 L433,1032 Q540,1064 647,1032 L696,822 Q540,884 384,822 Z" /></clipPath>
      </>
    }>
      <g fill="#fff" opacity={0.06}>
        <rect x={70} y={120} width={300} height={170} rx={30} transform="rotate(-12 220 200)" />
        <circle cx={880} cy={1180} r={130} />
        <rect x={40} y={1090} width={260} height={150} rx={75} transform="rotate(8 170 1165)" />
      </g>
      <g stroke="#fff" opacity={0.1} strokeWidth={3} strokeLinecap="round">
        <line x1={120} y1={640} x2={300} y2={610} />
        <line x1={760} y1={120} x2={980} y2={150} />
        <line x1={830} y1={980} x2={990} y2={930} />
      </g>
      <Paper id="st-p" opacity={0.28} />

      {/* the kulhad sticker */}
      <g filter="url(#st-sh)">
        <g transform={`translate(0 ${j(9) * 0.6}) rotate(${j(1) * 0.4} 540 900)`}>
          <path d={P.kulhadBody} fill="#fff" stroke="#fff" strokeWidth={46} strokeLinejoin="round" />
          <path d={P.rim} fill="#fff" stroke="#fff" strokeWidth={46} strokeLinejoin="round" />
          <path d={P.kulhadBody} fill="#E8743B" stroke={S_INK} strokeWidth={10} strokeLinejoin="round" />
          <g clipPath="url(#st-body)">
            <rect x={340} y={800} width={400} height={300} fill="#F7B38A" />
            {stepLevel > 0 ? (
              <>
                <path d={wave(-9)} fill="#fff" />
                <path d={wave(0)} fill="#92480F" />
              </>
            ) : null}
          </g>
          <path d="M384,822 L433,1032 Q540,1064 647,1032 L696,822 Q540,884 384,822 Z" fill="none" stroke={S_INK} strokeWidth={7} strokeLinejoin="round" />
          <path d={P.rim} fill="#C4532A" stroke={S_INK} strokeWidth={10} />
          <ellipse cx={540} cy={806} rx={136} ry={28} fill="#5B2A14" />
          {live.level > 0 ? <ellipse cx={live.surface.cx} cy={live.surface.cy} rx={live.surface.rx * 0.92} ry={live.surface.ry * 0.86} fill="#B8681E" /> : null}
        </g>
      </g>

      {pour ? (
        <g filter="url(#st-sh)">
          <path d={live.stream} {...white} strokeWidth={56} />
          <path d={live.stream} fill="none" stroke={S_INK} strokeWidth={36} strokeLinecap="round" />
          <path d={live.stream} fill="none" stroke="#B8681E" strokeWidth={26} strokeLinecap="round" />
        </g>
      ) : null}

      {live.steam.map((p, i) => (p > 0.03 ? (
        <g key={i} filter="url(#st-sh)">
          <path d={steamPath(i, p, sf * 0.03)} {...white} strokeWidth={60} />
          <path d={steamPath(i, p, sf * 0.03)} fill="none" stroke={S_INK} strokeWidth={36} strokeLinecap="round" strokeLinejoin="round" />
          <path d={steamPath(i, p, sf * 0.03)} fill="none" stroke={steamCols[i]} strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null))}

      {/* the kettle sticker: moved in hops, like re-sticking it each time */}
      <g filter="url(#st-sh)">
        <g opacity={s.kx > 1330 ? 0 : 1} transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt + j(3)}) scale(${kScale})`}>
          <g {...white} strokeWidth={46}>
            <path d={P.kettleHandle} strokeWidth={66} />
            <path d={P.kettleSpout} fill="#fff" />
            <path d={P.kettleBody} fill="#fff" />
            <path d={P.kettleLid} fill="#fff" />
            <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill="#fff" />
          </g>
          <path d={P.kettleHandle} fill="none" stroke={S_INK} strokeWidth={36} strokeLinecap="round" />
          <path d={P.kettleHandle} fill="none" stroke="#FFD23F" strokeWidth={18} strokeLinecap="round" />
          <path d={P.kettleSpout} fill="#3CC9A5" stroke={S_INK} strokeWidth={10} strokeLinejoin="round" />
          <path d={P.kettleBody} fill="#5BE0BD" stroke={S_INK} strokeWidth={10} strokeLinejoin="round" />
          <path d={P.kettleBand} fill="none" stroke="#FF4F7B" strokeWidth={22} />
          <path d={P.kettleBand} fill="none" stroke={S_INK} strokeWidth={4} transform="translate(0 -13)" />
          <path d={P.kettleBand} fill="none" stroke={S_INK} strokeWidth={4} transform="translate(0 13)" />
          <path d="M-98,-30 C-118,20 -112,70 -90,104" fill="none" stroke="#fff" strokeWidth={15} strokeLinecap="round" />
          <path d={P.kettleLid} fill="#FFD23F" stroke={S_INK} strokeWidth={10} strokeLinejoin="round" />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 2} fill="#FF4F7B" stroke={S_INK} strokeWidth={9} />
        </g>
      </g>

      <WordSticker f={sf} t0={48} x={215} y={520} rot0={-10} text="POUR" fill="#FFD23F" size={132} />
      <WordSticker f={sf} t0={76} x={880} y={920} rot0={8} text="FILL" fill="#5BE0BD" size={124} />
      {slap(sf, 112) ? (
        <g filter="url(#st-sh)">
          <g transform={`translate(212 900) rotate(${-12 + (slap(sf, 112) as { r: number }).r}) scale(${(slap(sf, 112) as { s: number }).s})`}>
            <path d={burst(92, 134, 12)} fill="#fff" stroke="#fff" strokeWidth={34} strokeLinejoin="round" />
            <path d={burst(92, 134, 12)} fill="#FF3B5C" stroke={S_INK} strokeWidth={9} strokeLinejoin="round" />
            <text textAnchor="middle" y={30} fontFamily={LILITA} fontSize={84} fill="#FFF3B0" stroke={S_INK} strokeWidth={7} paintOrder="stroke" strokeLinejoin="round">HOT</text>
          </g>
        </g>
      ) : null}
      <WordSticker f={sf} t0={130} x={540} y={1232} rot0={-3} text="READY" fill="#FF9EC2" size={150} />
    </Stage>
  );
};

/* ---------- 52 Math diagram: construction lines, an angle, a plotted level ---------- */
const M_BG = "#0D1530";
const M_W = "#E9EEF8";
const M_Y = "#FFD166";
const M_T = "#58D6C7";
const M_P = "#FF7BA6";
const M_LV = Array.from({ length: DUR }, (_, i) => storyAt(i).level);
const M_STR = [470, 540, 610];

export const MathDiagram: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const draw = interpolate(f, [-26, 22], [0, 1], { ...cl, easing: ease });
  const yL = 1040 - 236 * s.level;
  const hw = 115 + (55 * (1040 - yL)) / 240;
  const p = pourSeg(f, s.tip, 548, yL);
  const AX = 790;
  const AY = 1040;
  const TW = 240;
  const px = AX + (f / (DUR - 1)) * TW;
  let curve = "";
  for (let i = 0; i <= Math.min(DUR - 1, f); i += 2) curve += `${i ? "L" : "M"}${(AX + (i / (DUR - 1)) * TW).toFixed(1)},${(1040 - 236 * M_LV[i]).toFixed(1)} `;
  const a = (s.tilt * Math.PI) / 180;
  const aEnd = { x: s.kx - 118 * Math.cos(a), y: s.ky - 118 * Math.sin(a) };
  const ang = Math.round(-s.tilt);
  const thin = { fill: "none", stroke: M_W, strokeWidth: 2.2, strokeOpacity: 0.55, strokeDasharray: "9 8" } as const;
  const solid = { fill: "none", stroke: M_W, strokeWidth: 4.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const mid = { x: s.kx - 76 * Math.cos(a * 0.5), y: s.ky - 76 * Math.sin(a * 0.5) };
  const pts: { x: number; y: number }[] = [];
  if (p.on) {
    const q = { x: p.x1 - 12, y: (p.y1 + p.y2) / 2 };
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push({
        x: (1 - t) * (1 - t) * p.x1 + 2 * (1 - t) * t * q.x + t * t * p.x2,
        y: (1 - t) * (1 - t) * p.y1 + 2 * (1 - t) * t * q.y + t * t * p.y2,
      });
    }
  }
  const envelope = (i: number, sign: number, q: number) => {
    let d = "";
    for (let k = 0; k <= 20; k++) {
      const t = (k / 20) * q;
      d += `${k ? "L" : "M"}${(M_STR[i] + sign * (16 + 34 * t)).toFixed(1)},${(770 - 370 * t).toFixed(1)} `;
    }
    return d;
  };
  const label = { fontFamily: STIX, fontStyle: "italic" as const, fill: M_W };
  return (
    <Stage bg={M_BG} defs={
      <>
        <pattern id="mt-grid" patternUnits="userSpaceOnUse" width={54} height={54}>
          <path d="M54,0 L0,0 L0,54" fill="none" stroke="#1E2C57" strokeWidth={1.5} />
        </pattern>
        <pattern id="mt-hatch" patternUnits="userSpaceOnUse" width={15} height={15} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={15} stroke={M_Y} strokeWidth={3.5} />
        </pattern>
        <clipPath id="mt-body"><path d={P.kulhadBody} /></clipPath>
        <marker id="mt-arr" markerWidth={10} markerHeight={10} refX={6} refY={3} orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill={M_W} /></marker>
      </>
    }>
      <rect width={W} height={H} fill="url(#mt-grid)" />

      {/* extended cup walls, base circle, rim chord */}
      <g opacity={draw}>
        <line x1={370} y1={800} x2={500} y2={1350} {...thin} />
        <line x1={710} y1={800} x2={580} y2={1350} {...thin} />
        <line x1={250} y1={800} x2={830} y2={800} {...thin} />
        <line x1={540} y1={560} x2={540} y2={1250} {...thin} />
        <circle cx={540} cy={1040} r={115} {...thin} />
        <path d="M540,1040 L655,1040" stroke={M_T} strokeWidth={3.5} fill="none" />
        <text {...label} x={590} y={1030} fontSize={40} fill={M_T}>r</text>
        <circle cx={540} cy={1040} r={6} fill={M_T} />
      </g>

      {/* chai as a hatched cross-section */}
      {s.level > 0.003 ? (
        <g clipPath="url(#mt-body)">
          <rect x={360} y={yL} width={360} height={1090 - yL} fill="url(#mt-hatch)" opacity={0.75} />
        </g>
      ) : null}
      <path d={P.kulhadOutline} {...solid} pathLength={1} strokeDasharray={`${draw} 1.1`} />
      <path d={P.rim} {...solid} strokeWidth={3.5} pathLength={1} strokeDasharray={`${draw} 1.1`} />
      {s.level > 0.003 ? <ellipse cx={540} cy={yL} rx={hw} ry={hw * 0.24} fill={M_BG} fillOpacity={0.45} stroke={M_Y} strokeWidth={4} /> : null}

      {/* the plot shares its vertical scale with the cup */}
      <g opacity={draw}>
        <line x1={AX} y1={AY + 14} x2={AX} y2={770} stroke={M_W} strokeWidth={3} markerEnd="url(#mt-arr)" />
        <line x1={AX - 14} y1={AY} x2={AX + TW + 28} y2={AY} stroke={M_W} strokeWidth={3} markerEnd="url(#mt-arr)" />
        <text {...label} x={AX + 14} y={778} fontSize={40}>h(t)</text>
        <text {...label} x={AX + TW + 14} y={AY + 46} fontSize={40}>t</text>
        <line x1={AX - 8} x2={AX + 8} y1={804} y2={804} stroke={M_W} strokeWidth={3} />
      </g>
      <path d={curve} fill="none" stroke={M_Y} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
      {f >= 42 ? <line x1={540 + hw} y1={yL} x2={px} y2={yL} stroke={M_Y} strokeWidth={2.2} strokeDasharray="7 7" /> : null}
      <line x1={px} y1={yL} x2={px} y2={AY} stroke={M_Y} strokeWidth={2.2} strokeDasharray="7 7" />
      <circle cx={px} cy={yL} r={9} fill={M_BG} stroke={M_Y} strokeWidth={4.5} />

      {/* steam: sine curves between their envelopes */}
      {s.steam.map((q, i) => (q > 0 ? (
        <g key={i}>
          <path d={envelope(i, -1, q)} {...thin} stroke={M_T} strokeOpacity={0.6} />
          <path d={envelope(i, 1, q)} {...thin} stroke={M_T} strokeOpacity={0.6} />
          <path d={steamPath(i, q, f * 0.05)} fill="none" stroke={M_T} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null))}
      {s.steam[1] > 0.6 ? <text {...label} x={640} y={470} fontSize={38} fill={M_T}>A sin(ωz)</text> : null}

      {/* the pour, marked at equal steps */}
      {p.on ? <path d={pourD(p)} fill="none" stroke={M_P} strokeWidth={5} strokeLinecap="round" /> : null}
      {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={i === 0 || i === 8 ? 9 : 5.5} fill={i === 0 || i === 8 ? M_BG : M_P} stroke={M_P} strokeWidth={4} />)}
      {pts.length ? <text {...label} x={p.x1 - 58} y={p.y1 + 14} fontSize={42} fill={M_P}>A</text> : null}
      {pts.length ? <text {...label} x={p.x2 + 20} y={p.y2 - 4} fontSize={42} fill={M_P}>B</text> : null}

      {/* the kettle as construction: circle, axes, tangent */}
      <line x1={s.kx - 330} y1={s.ky} x2={s.kx + 170} y2={s.ky} {...thin} opacity={s.kx > 1330 ? 0 : 1} />
      <g opacity={s.kx > 1330 ? 0 : 1} transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <circle cx={0} cy={20} r={170} {...thin} />
        <line x1={0} y1={-240} x2={0} y2={210} {...thin} />
        <line x1={-340} y1={0} x2={230} y2={0} {...thin} />
        <line x1={-340} y1={-77} x2={-100} y2={-10} {...thin} stroke={M_T} />
        <path d={P.kettleBody} {...solid} />
        <path d={P.kettleLid} {...solid} strokeWidth={3.5} />
        <path d={P.kettleSpout} {...solid} />
        <path d={P.kettleHandle} {...solid} />
        <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} {...solid} strokeWidth={3.5} />
        <circle cx={0} cy={0} r={6} fill={M_W} />
      </g>
      {ang > 0 ? (
        <>
          <path d={`M${s.kx - 118},${s.ky} A118,118 0 0,0 ${aEnd.x.toFixed(1)},${aEnd.y.toFixed(1)}`} fill="none" stroke={M_P} strokeWidth={4.5} />
          <text {...label} x={mid.x - 10} y={mid.y + 14} fontSize={44} fill={M_P}>θ</text>
          <text {...label} x={80} y={120} fontSize={64} fill={M_P}>{`θ = ${ang}°`}</text>
        </>
      ) : null}
    </Stage>
  );
};

