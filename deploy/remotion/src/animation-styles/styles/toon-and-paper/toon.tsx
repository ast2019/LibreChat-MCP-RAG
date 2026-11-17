import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, rot, steamPath, storyAt } from "../../story";
import { clamp, hash, ik, parseStream } from "./util";

/* ---------- 17 2D flat vector: geometric shapes, split-tone shading, smooth easing ---------- */
const FV = { bg: "#3f37c9", halo: "#4f46e0", table: "#2a2391", edge: "#ff7b5f", kettle: "#ffd166", kettleD: "#f4a93a", dark: "#1b1668", cup: "#f26b3a", cupD: "#d24e22", rim: "#ffa06e", in: "#6e2a12", chai: "#b5651d", chaiL: "#d98a3d", leaf: "#2ed3a7", leafD: "#16a884", steam: "#cfcbff" };
const FV_BODY = "M-122,-82 L122,-82 Q176,60 138,128 Q130,142 112,142 L-112,142 Q-130,142 -138,128 Q-176,60 -122,-82 Z";

export const FlatVector: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const q = parseStream(s.stream);
  const land = s.streaming && f < 100 ? 1 : 0;
  const squash = Math.sin(interpolate(f, [42, 60], [0, Math.PI], clamp)) * 0.035;
  const pop = interpolate(f, [100, 124], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) * (1 - t) });
  const drift = (a: number, r: number) => Math.sin(f * 0.035 + a) * r;
  return (
    <Stage bg={FV.bg} defs={
      <>
        <clipPath id="fv-rim"><ellipse cx={540} cy={800} rx={150} ry={34} /></clipPath>
        <clipPath id="fv-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="fv-k"><path d={FV_BODY} /></clipPath>
      </>
    }>
      <circle cx={540} cy={640} r={452} fill={FV.halo} />
      <circle cx={186 + drift(0, 10)} cy={266 + drift(1, 12)} r={26} fill={FV.edge} />
      <circle cx={936 + drift(2, 8)} cy={806 + drift(3, 10)} r={18} fill={FV.kettle} />
      <circle cx={132 + drift(4, 9)} cy={620 + drift(5, 8)} r={44} fill="none" stroke={FV.steam} strokeWidth={12} opacity={0.6} />
      <g transform={`translate(${880 + drift(6, 10)} ${1010 - 50}) rotate(${f * 0.4})`}>
        <rect x={-30} y={-7} width={60} height={14} rx={7} fill={FV.leaf} />
        <rect x={-7} y={-30} width={14} height={60} rx={7} fill={FV.leaf} />
      </g>

      <rect y={1010} width={W} height={H - 1010} fill={FV.table} />
      <rect y={1010} width={W} height={18} fill={FV.edge} />
      <rect y={1216} width={W} height={10} fill={FV.dark} />

      <g>
        <path d="M172,930 Q88,810 160,700 Q206,810 172,930 Z" fill={FV.leaf} />
        <path d="M172,930 Q160,810 160,700 Q206,810 172,930 Z" fill={FV.leafD} />
        <path d="M176,930 Q262,840 300,740 Q196,776 176,930 Z" fill={FV.leafD} />
        <path d="M168,932 Q60,880 34,800 Q132,800 168,932 Z" fill={FV.leaf} />
        <path d="M106,920 H238 L220,1026 Q172,1036 124,1026 Z" fill={FV.steam} />
        <path d="M172,920 H238 L220,1026 Q196,1032 172,1032 Z" fill="#a8a2f2" />
      </g>

      <ellipse cx={560} cy={1060} rx={250} ry={24} fill={FV.dark} />

      <g transform={`translate(540 1058) scale(${1 + squash} ${1 - squash}) translate(-540 -1058)`}>
        <path d={P.kulhadBody} fill={FV.cup} />
        <g clipPath="url(#fv-body)">
          <rect x={540} y={760} width={220} height={340} fill={FV.cupD} />
          <path d="M416,860 L440,985" stroke="#ffc7a3" strokeWidth={16} strokeLinecap="round" fill="none" />
        </g>
        <ellipse cx={540} cy={800} rx={170} ry={42} fill={FV.rim} />
        <path d="M540,758 A170,42 0 0 1 540,842 Z" fill="#ec8a55" />
        <ellipse cx={540} cy={800} rx={150} ry={34} fill={FV.in} />
        <g clipPath="url(#fv-rim)">
          {s.level > 0 ? (
            <>
              <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={FV.chai} />
              <path d={`M${s.surface.cx - s.surface.rx * 0.7},${s.surface.cy - 6} Q${s.surface.cx},${s.surface.cy - s.surface.ry * 1.05} ${s.surface.cx + s.surface.rx * 0.5},${s.surface.cy - 10}`} fill="none" stroke={FV.chaiL} strokeWidth={8} strokeLinecap="round" />
              {land ? [0, 1, 2].map((i) => {
                const t = ((f + i * 7) % 21) / 21;
                return <ellipse key={i} cx={548} cy={s.surface.cy} rx={20 + 90 * t} ry={5 + 20 * t} fill="none" stroke={FV.chaiL} strokeWidth={5} opacity={1 - t} />;
              }) : null}
            </>
          ) : null}
        </g>
      </g>

      {s.streaming ? (
        <>
          <path d={s.stream} fill="none" stroke={FV.chai} strokeWidth={26} strokeLinecap="round" />
          <path d={s.stream} fill="none" stroke={FV.chaiL} strokeWidth={8} strokeLinecap="round" transform="translate(-5 0)" />
        </>
      ) : null}
      {land ? [0, 1, 2, 3].map((i) => {
        const t = ((f + i * 5) % 15) / 15;
        const a = -2.6 + i * 0.7;
        return <circle key={i} cx={q.x2 + Math.cos(a) * 80 * t} cy={q.y2 + Math.sin(a) * 60 * t + 90 * t * t} r={8 * (1 - t) + 2} fill={FV.chaiL} />;
      }) : null}

      <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
        <path d="M136,-44 C262,-76 262,100 136,94" fill="none" stroke={FV.dark} strokeWidth={28} strokeLinecap="round" />
        <path d="M-138,44 C-196,18 -226,-30 -263,-50 L-240,-77 C-206,-56 -170,-50 -122,-54 Z" fill={FV.kettleD} />
        <path d={FV_BODY} fill={FV.kettle} />
        <g clipPath="url(#fv-k)">
          <rect x={0} y={-120} width={200} height={300} fill={FV.kettleD} />
          <rect x={-200} y={38} width={400} height={30} fill={FV.dark} />
        </g>
        <path d="M-122,-82 A122,62 0 0 1 122,-82 Z" fill={FV.edge} />
        <path d="M0,-144 A122,62 0 0 1 122,-82 L0,-82 Z" fill="#e65e42" />
        <circle cx={KNOB.x} cy={KNOB.y - 14} r={KNOB.r + 3} fill={FV.dark} />
      </g>

      {s.steam.map((p, i) =>
        p > 0 ? <path key={i} d={steamPath(i, p, f * 0.05)} fill="none" stroke={FV.steam} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" /> : null,
      )}
      {pop > 0 ? Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 - 0.2;
        const r = 230 + 200 * pop;
        return <circle key={i} cx={540 + Math.cos(a) * r} cy={880 + Math.sin(a) * r * 0.8} r={13 * (1 - pop) + 0.01} fill={i % 2 ? FV.kettle : FV.leaf} />;
      }) : null}
    </Stage>
  );
};

/* ---------- 21 80s cel anime: painted dusk, hard cel shadows, airbrush bloom and star glints ---------- */
const AN = { line: "#1a1233", steel: "#6d8bb4", steelS: "#2f3f73", steelH: "#e8f6ff", cup: "#cf6a3e", cupS: "#7f2f3a", cupH: "#f6b890", chai: "#a2581c", chaiH: "#f3c07a", pink: "#ff8fbb" };
const Star4: React.FC<{ x: number; y: number; s: number; rot?: number }> = ({ x, y, s, rot: r = 0 }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <path d="M0,-100 Q6,-6 100,0 Q6,6 0,100 Q-6,6 -100,0 Q-6,-6 0,-100 Z" fill="#fff" />
    <circle r={16} fill="#fff" />
  </g>
);
const AN_TOWN = (() => {
  const b: { x: number; y: number; w: number }[] = [];
  let x = -40;
  let i = 0;
  while (x < W + 100) {
    const w = 62 + hash(i * 3.3) * 110;
    b.push({ x, w, y: 780 + hash(i * 7.1) * 180 });
    x += w;
    i++;
  }
  return b;
})();

export const CelAnime80s: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const jit = { x: (hash(sf * 1.9) - 0.5) * 1.6, y: (hash(sf * 2.7) - 0.5) * 1.6 };
  const pan = f * 0.32;
  const line = { stroke: AN.line, strokeWidth: 4.5, strokeLinejoin: "round", strokeLinecap: "round" } as const;
  const g = Math.sin(interpolate(f, [30, 60], [0, Math.PI], clamp));
  const g2 = Math.sin(interpolate(f, [86, 116], [0, Math.PI], clamp));
  const tipGlint = rot(-92, -62, s.tilt);
  return (
    <Stage bg="#301a64" defs={
      <>
        <linearGradient id="an-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#23185c" /><stop offset="30%" stopColor="#6a2a8c" /><stop offset="56%" stopColor="#e24e80" /><stop offset="74%" stopColor="#ffa763" /><stop offset="86%" stopColor="#ffdf9e" />
        </linearGradient>
        <linearGradient id="an-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7a3f4a" /><stop offset="100%" stopColor="#2c1740" />
        </linearGradient>
        <radialGradient id="an-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbe0" /><stop offset="42%" stopColor="#ffe9a8" stopOpacity={0.95} /><stop offset="100%" stopColor="#ff9a6a" stopOpacity={0} />
        </radialGradient>
        <filter id="an-paint" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.022" numOctaves={3} seed={21} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={90} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation={7} />
        </filter>
        <filter id="an-air" {...region}><feGaussianBlur stdDeviation={11} /></filter>
        <filter id="an-bloom" {...region}>
          <feColorMatrix values="1.4 0 0 0 -0.55  0 1.4 0 0 -0.55  0 0 1.4 0 -0.55  0 0 0 1 0" />
          <feGaussianBlur stdDeviation={20} />
        </filter>
        <filter id="an-glint" {...region}>
          <feGaussianBlur stdDeviation={5} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="an-grain" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.75} numOctaves={2} seed={sf + 2} />
          <feColorMatrix values="0 0 0 0 0.75  0 0 0 0 0.7  0 0 0 0 0.8  0 0 0 1.9 -0.82" />
        </filter>
        <clipPath id="an-kb"><path d={P.kettleBody} /></clipPath>
        <clipPath id="an-cb"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="an-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <g id="an-scene">
        {/* painted background pans smoothly under cels held on threes */}
        <rect width={W} height={1120} fill="url(#an-sky)" />
        <circle cx={270} cy={690} r={340} fill="url(#an-sun)" />
        <g filter="url(#an-paint)" transform={`translate(${-pan} 0)`}>
          <ellipse cx={320} cy={260} rx={460} ry={46} fill="#ff7fa8" opacity={0.85} />
          <ellipse cx={850} cy={380} rx={420} ry={58} fill="#c94d9a" opacity={0.9} />
          <ellipse cx={1100} cy={190} rx={380} ry={36} fill="#8f3fa8" opacity={0.85} />
          <ellipse cx={200} cy={500} rx={380} ry={40} fill="#ffc48a" opacity={0.95} />
          <ellipse cx={760} cy={570} rx={520} ry={44} fill="#ff9d7a" opacity={0.92} />
          <ellipse cx={900} cy={700} rx={330} ry={26} fill="#ffd9a0" opacity={0.9} />
        </g>
        <g transform={`translate(${-pan * 0.4} 0)`}>
          {AN_TOWN.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={b.y} width={b.w + 1} height={1120 - b.y} fill={i % 3 ? "#3a2466" : "#2d1b58"} />
              {Array.from({ length: 12 }, (_, k) => {
                const on = hash(i * 13 + k * 3.1) > 0.68;
                const wx = b.x + 12 + (k % 3) * ((b.w - 24) / 3);
                const wy = b.y + 18 + Math.floor(k / 3) * 34;
                return on ? <rect key={k} x={wx} y={wy} width={12} height={16} fill="#ffd77a" /> : null;
              })}
            </g>
          ))}
        </g>
        {/* tabletop */}
        <rect y={1020} width={W} height={330} fill="url(#an-wood)" />
        <rect y={1020} width={W} height={7} fill="#ffb892" />
        {[1092, 1178, 1270].map((y, i) => (
          <path key={i} d={`M0,${y} Q540,${y - 20} 1080,${y}`} stroke="#1f1032" strokeWidth={3} fill="none" opacity={0.5} />
        ))}
        <path d="M640,1042 L1080,1160 L1080,1090 L680,1020 Z" fill="#180c2c" opacity={0.75} />

        <g transform={`translate(${jit.x} ${jit.y})`}>
          {/* cup cel */}
          <path d={P.kulhadBody} fill={AN.cup} />
          <g clipPath="url(#an-cb)">
            <path d="M520,780 C610,860 590,1000 512,1090 L740,1090 L740,780 Z" fill={AN.cupS} />
            <path d="M396,830 C404,900 424,970 446,1034 L470,1046 C446,960 428,900 420,826 Z" fill={AN.cupH} />
            <rect x={360} y={906} width={380} height={8} fill={AN.cupS} opacity={0.55} />
          </g>
          <path d={P.kulhadOutline} fill="none" {...line} />
          <path d={P.rim} fill="#e39068" {...line} />
          <ellipse cx={540} cy={806} rx={150} ry={32} fill="#3b1830" />
          <g clipPath="url(#an-rim)">
            {s.level > 0 ? (
              <>
                <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={AN.chai} />
                <path d={`M${s.surface.cx + 20},${s.surface.cy - s.surface.ry} A${s.surface.rx},${s.surface.ry} 0 0 1 ${s.surface.cx + 20},${s.surface.cy + s.surface.ry} Q${s.surface.cx + 90},${s.surface.cy} ${s.surface.cx + 20},${s.surface.cy - s.surface.ry} Z`} fill="#6b3314" />
                <ellipse cx={s.surface.cx - 58} cy={s.surface.cy - 8} rx={44} ry={7} fill={AN.chaiH} />
              </>
            ) : null}
          </g>

          {s.streaming ? (
            <>
              <path d={s.stream} fill="none" stroke={AN.line} strokeWidth={26} strokeLinecap="round" />
              <path d={s.stream} fill="none" stroke={AN.chai} strokeWidth={18} strokeLinecap="round" />
              <path d={s.stream} fill="none" stroke={AN.chaiH} strokeWidth={5} strokeLinecap="round" transform="translate(-4 0)" />
            </>
          ) : null}

          {/* kettle cel */}
          <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
            <path d={P.kettleHandle} fill="none" stroke={AN.line} strokeWidth={32} strokeLinecap="round" />
            <path d={P.kettleHandle} fill="none" stroke="#3a2f55" strokeWidth={23} strokeLinecap="round" />
            <path d={P.kettleSpout} fill={AN.steelS} {...line} />
            <path d="M-246,-62 C-210,-44 -176,-26 -140,-18" fill="none" stroke={AN.steelH} strokeWidth={7} strokeLinecap="round" />
            <path d={P.kettleBody} fill={AN.steelS} />
            <g clipPath="url(#an-kb)">
              <path d={P.kettleBody} fill={AN.steel} transform="translate(-56 -18)" />
              <path d="M-132,-60 C-152,20 -142,90 -112,122" fill="none" stroke={AN.pink} strokeWidth={12} />
              <path d="M-96,-68 C-118,-20 -118,10 -112,38 L-82,38 C-92,10 -88,-30 -60,-72 Z" fill={AN.steelH} />
              <path d="M-58,-72 C-74,-44 -80,-20 -78,2 L-66,2 C-68,-26 -56,-52 -44,-74 Z" fill={AN.steelH} />
              <path d={P.kettleBand} fill="none" stroke={AN.line} strokeWidth={4} />
            </g>
            <path d={P.kettleBody} fill="none" {...line} />
            <path d={P.kettleLid} fill="#8fa8cc" {...line} />
            <path d="M-60,-104 Q-20,-126 18,-124" fill="none" stroke={AN.steelH} strokeWidth={7} strokeLinecap="round" />
            <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill={AN.pink} {...line} />
          </g>
        </g>

        {/* airbrushed steam */}
        {s.steam.map((p, i) =>
          p > 0 ? <path key={i} d={steamPath(i, p, f * 0.05)} fill="none" stroke="#ffe9f4" strokeWidth={34} strokeLinecap="round" strokeLinejoin="round" filter="url(#an-air)" opacity={0.78} /> : null,
        )}
      </g>

      <use href="#an-scene" filter="url(#an-bloom)" style={{ mixBlendMode: "screen" }} opacity={0.72} />

      {g > 0 ? (
        <g filter="url(#an-glint)" style={{ mixBlendMode: "screen" }}>
          <Star4 x={s.kx + tipGlint.x} y={s.ky + tipGlint.y} s={0.95 * g} rot={f * 0.6} />
        </g>
      ) : null}
      {g2 > 0 ? (
        <g filter="url(#an-glint)" style={{ mixBlendMode: "screen" }}>
          <Star4 x={470} y={s.surface.cy - 6} s={0.8 * g2} rot={22} />
        </g>
      ) : null}
      {Array.from({ length: 14 }, (_, i) => {
        const t = ((f / 150 + hash(i * 2.1)) % 1);
        return <circle key={i} cx={hash(i * 3.3) * W + Math.sin(f * 0.04 + i) * 16} cy={1000 - t * 800} r={2 + hash(i) * 3} fill="#ffe7c2" opacity={0.65 * Math.sin(t * Math.PI)} />;
      })}
      <rect width={W} height={H} filter="url(#an-grain)" opacity={0.3} />
    </Stage>
  );
};

/* ---------- 22 Stick figure: white round head, ink limbs, one hanging lamp ---------- */
const SK = { ink: "#0b0c10", white: "#f5f3ec", wallLit: "#7b7360", wall: "#14171f", floor: "#22242b", amber: "#e8912a", shirt: "#c8412b" };
const toSX = (x: number) => 0.8 * x - 120;
const toSY = (y: number) => 0.8 * y + 130;
const GRIP = { x: 227, y: 25 };

export const StickFigure: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const kx = toSX(s.kx) + ((s.kx - 796) / 560) * 400;
  const ky = toSY(s.ky);
  const g = rot(GRIP.x * 0.8, GRIP.y * 0.8, s.tilt);
  const hand = { x: kx + g.x, y: ky + g.y };
  const bx = kx + 330;
  const walking = s.kx > 800 && s.kx < 1350;
  const phase = s.kx * 0.021;
  const bob = walking ? Math.abs(Math.sin(phase)) * 10 : Math.sin(sf * 0.1) * 2;
  const floorY = 1212;
  const hipY = 716 - bob;
  const shoulderY = 468 - bob;
  const lean = interpolate(s.tilt, [-38, 0], [-22, 0], clamp);
  const hip = { x: bx, y: hipY };
  const sh = { x: bx + lean, y: shoulderY };
  const head = { x: sh.x + lean * 0.5, y: shoulderY - 112 };
  const footAx = bx - 50 + (walking ? Math.sin(phase) * 95 : 0);
  const footBx = bx + 66 - (walking ? Math.sin(phase) * 95 : 0);
  const liftA = walking ? Math.max(0, Math.cos(phase)) * 54 : 0;
  const liftB = walking ? Math.max(0, -Math.cos(phase)) * 54 : 0;
  const footA = { x: footAx, y: floorY - liftA };
  const footB = { x: footBx, y: floorY - liftB };
  const kneeA = ik(hip.x - 12, hip.y, footA.x, footA.y - 22, 262, 262, -1);
  const kneeB = ik(hip.x + 12, hip.y, footB.x, footB.y - 22, 262, 262, -1);
  const elbow = ik(sh.x - 22, sh.y + 8, hand.x, hand.y, 150, 150, -1);
  const swing = walking ? Math.sin(phase) * 60 : 0;
  const freeHand = { x: sh.x + 62 + swing, y: sh.y + 262 };
  const freeElbow = ik(sh.x + 24, sh.y + 8, freeHand.x, freeHand.y, 135, 135, 1);
  const blink = sf % 58 < 4;
  const glad = interpolate(sf, [100, 112], [0, 1], clamp);
  const stroke = { fill: "none", stroke: SK.ink, strokeWidth: 11, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const lampSwing = Math.sin(f * 0.05) * 7;

  const limb = (a: { x: number; y: number }, m: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x},${a.y} L${m.x},${m.y} L${b.x},${b.y}`;

  const figure = (shadow?: boolean) => {
    const ink = shadow ? "#000" : SK.ink;
    return (
      <g>
        <path d={limb({ x: hip.x + 12, y: hip.y }, kneeB, { x: footB.x, y: footB.y - 22 })} {...stroke} stroke={ink} />
        <path d={limb({ x: sh.x + 24, y: sh.y + 8 }, freeElbow, freeHand)} {...stroke} stroke={ink} />
        <path d={limb({ x: hip.x - 12, y: hip.y }, kneeA, { x: footA.x, y: footA.y - 22 })} {...stroke} stroke={ink} />
        <path d={`M${sh.x - 44},${sh.y - 4} L${sh.x + 44},${sh.y - 4} L${hip.x + 30},${hip.y + 14} L${hip.x - 30},${hip.y + 14} Z`} fill={shadow ? "#000" : SK.shirt} stroke={ink} strokeWidth={9} strokeLinejoin="round" />
        <path d={limb({ x: sh.x - 22, y: sh.y + 8 }, elbow, hand)} {...stroke} stroke={ink} />
        {[footA, footB].map((ft, i) => (
          <path key={i} d={`M${ft.x - 44},${ft.y} Q${ft.x - 44},${ft.y - 28} ${ft.x - 8},${ft.y - 30} L${ft.x + 26},${ft.y - 30} Q${ft.x + 30},${ft.y} ${ft.x + 30},${ft.y} Z`} fill={shadow ? "#000" : SK.white} stroke={ink} strokeWidth={9} strokeLinejoin="round" />
        ))}
        <circle cx={freeHand.x} cy={freeHand.y} r={19} fill={shadow ? "#000" : SK.white} stroke={ink} strokeWidth={8} />
        <circle cx={head.x} cy={head.y} r={84} fill={shadow ? "#000" : SK.white} stroke={ink} strokeWidth={10} />
        {shadow ? null : (
          <>
            {blink ? (
              <>
                <path d={`M${head.x - 54},${head.y - 6} h22`} {...stroke} strokeWidth={7} />
                <path d={`M${head.x - 8},${head.y - 6} h22`} {...stroke} strokeWidth={7} />
              </>
            ) : (
              <>
                <circle cx={head.x - 44} cy={head.y - 5 + (s.streaming ? 4 : 0)} r={9} fill={SK.ink} />
                <circle cx={head.x + 4} cy={head.y - 5 + (s.streaming ? 4 : 0)} r={9} fill={SK.ink} />
              </>
            )}
            <path d={`M${head.x - 62},${head.y - 32 - glad * 8} L${head.x - 30},${head.y - 32 - glad * 8}`} {...stroke} strokeWidth={6} />
            <path d={`M${head.x - 8},${head.y - 32 - glad * 8} L${head.x + 22},${head.y - 32 - glad * 8}`} {...stroke} strokeWidth={6} />
            <path d={`M${head.x - 42},${head.y + 34} Q${head.x - 20},${head.y + 34 + 6 + glad * 18} ${head.x + 2},${head.y + 34}`} {...stroke} strokeWidth={6} />
          </>
        )}
      </g>
    );
  };

  return (
    <Stage bg={SK.wall} defs={
      <>
        <radialGradient id="sk-wall" gradientUnits="userSpaceOnUse" cx={540} cy={560} r={720}>
          <stop offset="0%" stopColor="#a39877" /><stop offset="52%" stopColor={SK.wallLit} /><stop offset="100%" stopColor={SK.wall} />
        </radialGradient>
        <radialGradient id="sk-floor" gradientUnits="userSpaceOnUse" cx={540} cy={1230} r={620} gradientTransform="translate(0 860) scale(1 0.3)">
          <stop offset="0%" stopColor="#7c7158" /><stop offset="70%" stopColor="#3a3730" /><stop offset="100%" stopColor={SK.floor} />
        </radialGradient>
        <filter id="sk-shadow" {...region}><feGaussianBlur stdDeviation={15} /></filter>
        <filter id="sk-lamp" {...region}><feGaussianBlur stdDeviation={34} /></filter>
        <filter id="sk-grain" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.8} numOctaves={2} seed={sf + 1} />
          <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.1  0 0 0 0 0.12  0 0 0 1.7 -0.72" />
        </filter>
        <radialGradient id="sk-v" cx="50%" cy="46%" r="72%">
          <stop offset="58%" stopColor="#000" stopOpacity={0} /><stop offset="100%" stopColor="#000" stopOpacity={0.82} />
        </radialGradient>
        <clipPath id="sk-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <rect width={W} height={1160} fill="url(#sk-wall)" />
      <rect y={1140} width={W} height={H - 1140} fill="url(#sk-floor)" />
      <path d="M0,1142 H1080" stroke={SK.ink} strokeWidth={7} />
      <path d="M506,120 L-140,1210 H1220 L574,120 Z" fill="#ffe6ae" opacity={0.13} filter="url(#sk-lamp)" />
      {/* set dressing, barely lit */}
      <path d="M70,250 H300 V640 H70 Z M185,250 V640 M70,444 H300" fill="none" stroke={SK.ink} strokeWidth={8} opacity={0.55} />
      <rect x={70} y={250} width={230} height={390} fill="#1b2330" opacity={0.6} />

      {/* cast shadow of figure and props on the wall */}
      <g filter="url(#sk-shadow)" opacity={0.42} transform="translate(82 42) scale(0.98)">
        {figure(true)}
      </g>
      <g filter="url(#sk-shadow)" opacity={0.4} transform="translate(54 34)">
        <rect x={100} y={984} width={500} height={24} fill="#000" />
      </g>

      {/* table and kulhad */}
      <path d="M150,1212 L176,992 M566,1212 L540,992" stroke={SK.ink} strokeWidth={13} strokeLinecap="round" />
      <rect x={84} y={974} width={560} height={26} rx={6} fill={SK.white} stroke={SK.ink} strokeWidth={9} />

      <g transform="translate(-120 130) scale(0.8)">
        <path d={P.kulhadBody} fill={SK.white} stroke={SK.ink} strokeWidth={12} strokeLinejoin="round" />
        <path d="M638,834 L606,1048 Q634,1046 655,1040 L702,834 Q670,852 638,834 Z" fill="#b9b5a8" />
        <path d={P.rim} fill={SK.white} stroke={SK.ink} strokeWidth={12} />
        <ellipse cx={540} cy={806} rx={148} ry={30} fill="#39342c" />
        <g clipPath="url(#sk-rim)">
          {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={SK.amber} /> : null}
        </g>
        {s.streaming ? <path d={s.stream} fill="none" stroke={SK.amber} strokeWidth={22} strokeLinecap="round" /> : null}
      </g>

      {/* kettle in the hand */}
      <g transform={`translate(${kx} ${ky}) rotate(${s.tilt}) scale(0.8)`}>
        <path d={P.kettleHandle} fill="none" stroke={SK.ink} strokeWidth={14} strokeLinecap="round" />
        <path d={P.kettleSpout} fill={SK.white} stroke={SK.ink} strokeWidth={12} strokeLinejoin="round" />
        <path d={P.kettleBody} fill={SK.white} stroke={SK.ink} strokeWidth={12} strokeLinejoin="round" />
        <path d={P.kettleBand} fill="none" stroke={SK.ink} strokeWidth={9} />
        <path d={P.kettleLid} fill={SK.white} stroke={SK.ink} strokeWidth={11} strokeLinejoin="round" />
        <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill={SK.white} stroke={SK.ink} strokeWidth={10} />
      </g>

      {figure()}
      <circle cx={hand.x} cy={hand.y} r={21} fill={SK.white} stroke={SK.ink} strokeWidth={8} />

      <g transform="translate(-120 130) scale(0.8)">
        {s.steam.map((p, i) =>
          p > 0 ? <path key={i} d={steamPath(i, p, sf * 0.06)} fill="none" stroke="#f1ece0" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} /> : null,
        )}
      </g>

      {/* the one light */}
      <g transform={`rotate(${lampSwing} 540 -40)`}>
        <path d="M540,-40 V72" stroke={SK.ink} strokeWidth={8} />
        <circle cx={540} cy={132} r={120} fill="#ffdf9a" opacity={0.42} filter="url(#sk-lamp)" />
        <path d="M478,124 Q540,20 602,124 Z" fill={SK.ink} />
        <path d="M512,124 A28,18 0 0 0 568,124 Z" fill="#fff0c2" />
      </g>
      {Array.from({ length: 22 }, (_, i) => {
        const t = (sf / 200 + hash(i * 2.2)) % 1;
        return <circle key={i} cx={hash(i * 4.4) * W + Math.sin(sf * 0.03 + i) * 26} cy={1180 - t * 1100} r={1.6 + hash(i * 6.6) * 2.4} fill="#fff1cb" opacity={0.5 * Math.sin(t * Math.PI)} />;
      })}
      <rect width={W} height={H} fill="url(#sk-v)" />
      <rect width={W} height={H} filter="url(#sk-grain)" opacity={0.3} />
    </Stage>
  );
};
