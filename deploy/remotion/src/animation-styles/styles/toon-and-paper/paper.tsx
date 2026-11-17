import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { circlePath, clamp, diamond, noise, parseStream, petal, quadAt } from "./util";

/* ---------- 24 Red papercut: a single red sheet, every shape cut from it, candlelight behind ---------- */
const scalloped = (x0: number, y0: number, x1: number, y1: number, step: number) => {
  const nx = Math.round((x1 - x0) / step);
  const ny = Math.round((y1 - y0) / step);
  const sx = (x1 - x0) / nx;
  const sy = (y1 - y0) / ny;
  const r = step / 2;
  let d = `M${x0},${y0} `;
  for (let i = 1; i <= nx; i++) d += `A${r},${r} 0 0 1 ${x0 + sx * i},${y0} `;
  for (let i = 1; i <= ny; i++) d += `A${r},${r} 0 0 1 ${x1},${y0 + sy * i} `;
  for (let i = 1; i <= nx; i++) d += `A${r},${r} 0 0 1 ${x1 - sx * i},${y1} `;
  for (let i = 1; i <= ny; i++) d += `A${r},${r} 0 0 1 ${x0},${y1 - sy * i} `;
  return d + "Z";
};

const rosette = (cx: number, cy: number, r0: number, len: number, wid: number, n: number) => {
  let d = "";
  for (let i = 0; i < n; i++) {
    const deg = (i / n) * 360;
    const a = (deg * Math.PI) / 180;
    d += petal(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, deg, len, wid);
  }
  return d;
};

const fan = (cx: number, cy: number, dir: number, len: number) => {
  let d = "";
  for (let k = -2; k <= 2; k++) d += petal(cx, cy, dir + k * 30, len - Math.abs(k) * 7, 13);
  return d;
};

const PC_WINDOW = scalloped(84, 138, 996, 1072, 52);

const PC_BORDER = (() => {
  let d = "";
  for (let y = 30; y < H; y += 42) {
    d += diamond(38, y, 11, 16);
    d += diamond(W - 38, y, 11, 16);
  }
  for (let x = 96; x < W - 80; x += 88) {
    d += fan(x, 104, -90, 62);
    d += circlePath(x + 44, 40, 11);
    d += diamond(x + 44, 86, 9, 22);
  }
  for (const [y, dir] of [[1168, -90], [1216, 90]] as const) {
    for (let x = 108; x < W - 80; x += 88) d += fan(x, y, dir, 58);
  }
  for (let x = 96; x < W - 80; x += 44) {
    d += diamond(x, 1100, 12, 12);
    d += circlePath(x + 22, 1296, 8);
    d += petal(x, 1312, 90, 26, 8);
  }
  d += rosette(540, 1192, 22, 54, 14, 14) + circlePath(540, 1192, 13);
  d += rosette(232, 1192, 14, 40, 10, 10) + rosette(848, 1192, 14, 40, 10, 10);
  return d;
})();

// A vine growing off the left border: the empty side of the window, where the kettle never goes.
const PC_VINE = "M84,1020 C190,960 92,820 186,720 C258,642 148,540 226,430 C258,386 300,350 330,282";
const PC_BUDS = [
  { x: 186, y: 720, r: 62 },
  { x: 226, y: 430, r: 52 },
  { x: 330, y: 266, r: 44 },
];
const PC_LEAVES = [
  { x: 150, y: 930, a: -20, l: 118 }, { x: 134, y: 840, a: 170, l: 54 }, { x: 240, y: 640, a: -35, l: 96 },
  { x: 196, y: 590, a: 190, l: 66 }, { x: 226, y: 510, a: 15, l: 92 }, { x: 278, y: 360, a: -8, l: 84 },
  { x: 270, y: 368, a: 205, l: 74 },
];
const PC_LEAF_SOLID = PC_LEAVES.map((l) => petal(l.x, l.y, l.a, l.l, 34)).join("");
const PC_LEAF_CUTS = PC_LEAVES.map((l) => petal(l.x + Math.cos((l.a * Math.PI) / 180) * 18, l.y + Math.sin((l.a * Math.PI) / 180) * 18, l.a, l.l * 0.62, 7)).join("");
const PC_BUD_SOLID = PC_BUDS.map((b) => rosette(b.x, b.y, 0, b.r, b.r * 0.42, 9)).join("");
const PC_BUD_CUTS = PC_BUDS.map((b) => rosette(b.x, b.y, b.r * 0.3, b.r * 0.5, b.r * 0.12, 9) + circlePath(b.x, b.y, b.r * 0.16)).join("");

const PC_CUP = (() => {
  let d = "";
  [872, 926, 1000].forEach((y, r) => {
    const l = 370 + ((y - 800) * 55) / 240;
    const rr = 710 - ((y - 800) * 55) / 240;
    const step = r === 1 ? 36 : 44;
    for (let x = l + 32; x <= rr - 26; x += step) d += r === 1 ? petal(x, y + 22, -90, 40, 11) : diamond(x, y, 11, 15);
  });
  d += rosette(540, 1002, 12, 0.1, 0.1, 1);
  return d;
})();

const PC_KETTLE = (() => {
  let d = rosette(-6, 0, 22, 60, 15, 12) + circlePath(-6, 0, 14);
  for (let x = -122; x <= 124; x += 30) d += diamond(x, 112, 9, 12);
  for (let x = -96; x <= 96; x += 32) d += petal(x, -40, 90, 0.1, 0.1);
  for (let i = 0; i < 8; i++) d += diamond(-96 + i * 27.5, -62 - Math.sin((i / 7) * Math.PI) * 4, 7, 11);
  d += petal(-190, -8, -152, 54, 7) + petal(-164, -22, 160, 28, 5);
  return d;
})();

export const RedPapercut: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const gelTop = 1064 - (1064 - s.surface.cy) * s.level;
  const flame = noise(f * 0.33, 2);
  const paper = { fill: "#fff" } as const;
  const cut = { fill: "#000" } as const;
  return (
    <Stage bg="#7d0b10" defs={
      <>
        <radialGradient id="pc-light" gradientUnits="userSpaceOnUse" cx={560} cy={590} r={860}>
          <stop offset="0%" stopColor="#fff6d4" /><stop offset="48%" stopColor="#ffd98a" /><stop offset="100%" stopColor="#ef9630" />
        </radialGradient>
        <radialGradient id="pc-red" gradientUnits="userSpaceOnUse" cx={540} cy={640} r={920}>
          <stop offset="0%" stopColor="#e11c26" /><stop offset="70%" stopColor="#c10f1a" /><stop offset="100%" stopColor="#8d0a13" />
        </radialGradient>
        <filter id="pc-sheet" {...region}>
          <feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
          <feGaussianBlur in="inv" stdDeviation={7} result="b" />
          <feFlood floodColor="#ffa24a" floodOpacity={0.95} />
          <feComposite in2="b" operator="in" result="g" />
          <feComposite in="g" in2="SourceAlpha" operator="in" result="edge" />
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.32" numOctaves={3} seed={9} />
          <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0  0 0 0 0 0.02  0 0 0 1.6 -0.68" />
          <feComposite in2="SourceAlpha" operator="in" result="fibre" />
          <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="fibre" /><feMergeNode in="edge" /></feMerge>
        </filter>
        <clipPath id="pc-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="pc-rim"><path d={P.rim} /></clipPath>
        <mask id="pc-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <rect width={W} height={H} {...paper} />
          <path d={PC_WINDOW} {...cut} />
          <path d={PC_BORDER} {...cut} />

          <path d={PC_VINE} fill="none" stroke="#fff" strokeWidth={15} strokeLinecap="round" />
          <path d={PC_LEAF_SOLID} {...paper} />
          <path d={PC_LEAF_CUTS} {...cut} />
          <path d={PC_BUD_SOLID} {...paper} />
          <path d={PC_BUD_CUTS} {...cut} />

          <path d={P.kulhadBody} {...paper} />
          <path d="M392,842 L438,1030 Q540,1060 642,1030 L688,842" fill="none" stroke="#000" strokeWidth={5} strokeDasharray="52 9" />
          <path d={PC_CUP} {...cut} />
          <path d={P.rim} {...paper} />
          <ellipse cx={540} cy={804} rx={150} ry={31} {...cut} />
          <g clipPath="url(#pc-rim)">
            {s.level > 0 ? (
              <>
                <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} {...paper} />
                <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.72} ry={s.surface.ry * 0.62} fill="none" stroke="#000" strokeWidth={4} strokeDasharray="20 8" />
                <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * 0.38} ry={s.surface.ry * 0.3} fill="none" stroke="#000" strokeWidth={4} strokeDasharray="12 7" />
              </>
            ) : null}
          </g>

          {s.streaming ? <path d={s.stream} fill="none" stroke="#fff" strokeWidth={22} strokeLinecap="round" /> : null}

          <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
            <path d={P.kettleHandle} fill="none" stroke="#fff" strokeWidth={26} strokeLinecap="round" />
            <path d={P.kettleHandle} fill="none" stroke="#000" strokeWidth={6} strokeDasharray="30 8" />
            <path d={P.kettleSpout} {...paper} />
            <path d={P.kettleBody} {...paper} />
            <path d={P.kettleLid} {...paper} />
            <path d="M-92,-96 h184 v18 h-184 Z" {...paper} />
            <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 3} {...paper} />
            <circle cx={KNOB.x} cy={KNOB.y} r={7} {...cut} />
            <path d={PC_KETTLE} {...cut} />
            <path d="M-120,-70 C-160,40 -142,126 -86,132 L86,132 C142,126 160,40 120,-70" fill="none" stroke="#000" strokeWidth={5} strokeDasharray="44 8" />
            {[-60, -30, 0, 30, 60].map((x) => <circle key={x} cx={x} cy={-112 + Math.abs(x) * 0.26} r={5} {...cut} />)}
          </g>

          {s.steam.map((p, i) =>
            p > 0 ? (
              <g key={i}>
                <path d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#fff" strokeWidth={17} strokeLinecap="round" strokeLinejoin="round" />
                <path d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#000" strokeWidth={4} strokeDasharray="22 14" />
              </g>
            ) : null,
          )}
        </mask>
      </>
    }>
      <rect width={W} height={H} fill="url(#pc-light)" />
      <rect x={350} y={gelTop} width={380} height={1090 - gelTop} fill="#ff4d00" clipPath="url(#pc-body)" />
      <rect width={W} height={H} fill="#b84a00" opacity={0.03 + flame * 0.13} />
      <g filter="url(#pc-sheet)">
        <rect width={W} height={H} fill="url(#pc-red)" mask="url(#pc-mask)" />
      </g>
    </Stage>
  );
};

/* ---------- 25 Paper pop-up: a real fold in CSS 3D, cards parallel to the page as the book opens ---------- */
const LH = 1100;
const PU = { ink: "#27313d", card: "#fbf6ea", page: "#16404f", pageL: "#245e70", sun: "#f6c453", wall: "#f0a94a", wallD: "#d8842e", tile: "#fbe7c2", clay: "#cc6235", clayD: "#a14421", steel: "#5e93a8", steelD: "#3b6a7f", chai: "#a85c1e", chaiL: "#d98b3c", leaf: "#3f9b78", leafD: "#2a7459", red: "#d4483a" };

const Card: React.FC<{ z: number; lean: number; bright: number; shadow?: boolean; children: React.ReactNode }> = ({ z, lean, bright, shadow = true, children }) => (
  <div style={{
    position: "absolute", left: 0, top: 0, width: W, height: LH,
    transformOrigin: "50% 100%",
    transform: `translateZ(${z}px) rotateX(${lean}deg)`,
    filter: `brightness(${bright})${shadow ? " drop-shadow(-7px 8px 7px rgba(10,20,30,0.42))" : ""}`,
  }}>
    <svg viewBox={`0 0 ${W} ${LH}`} width={W} height={LH} style={{ position: "absolute", inset: 0, overflow: "visible" }}>{children}</svg>
  </div>
);

export const PaperPopUp: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const q = parseStream(s.stream);
  const open = interpolate(f, [0, 34], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const lean = -46 * (1 - open) + 4 * open;
  const bright = 0.7 + 0.3 * open;
  const cam = -19 + Math.sin(f * 0.02) * 1;
  const yaw = -5 + open * 5 + Math.sin(f * 0.03) * 1.2;
  const edge = { stroke: PU.card, strokeWidth: 12, strokeLinejoin: "round", strokeLinecap: "round" } as const;
  const ground = [90, 170, 215, 240, 350];
  const fold = { stroke: "#b9ad97", strokeWidth: 3, strokeDasharray: "12 9", fill: "none" } as const;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 42%, #55748a 0%, #2c4356 70%, #1d2e3d 100%)", perspective: 2300, perspectiveOrigin: "50% 36%", overflow: "hidden" }}>
      <div style={{
        position: "absolute", left: 0, top: 0, width: W, height: LH, transformStyle: "preserve-3d",
        transformOrigin: `50% ${LH}px`,
        transform: `translateY(-150px) rotateX(${cam}deg) rotateY(${yaw}deg) scale(0.8)`,
      }}>
        {/* covers and the flat lower page */}
        <div style={{ position: "absolute", left: 14, top: LH, width: W - 28, height: 560, transformOrigin: "50% 0", transform: "translateZ(-8px) rotateX(90deg)", background: "#7a2a22", borderRadius: "0 0 16px 16px" }} />
        <div style={{ position: "absolute", left: 36, top: LH, width: W - 72, height: 526, transformOrigin: "50% 0", transform: "rotateX(90deg)", background: PU.card }}>
          <svg viewBox={`0 0 ${W - 72} 526`} width={W - 72} height={526} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="pu-gut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#000" stopOpacity={0.4} /><stop offset="14%" stopColor="#000" stopOpacity={0} />
              </linearGradient>
              <filter id="pu-soft" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation={13} /></filter>
            </defs>
            <rect x={22} y={12} width={W - 116} height={492} fill={PU.pageL} rx={8} />
            {Array.from({ length: 60 }, (_, i) => (
              <circle key={i} cx={46 + (i % 12) * 80} cy={40 + Math.floor(i / 12) * 94 + (i % 2) * 34} r={7} fill={PU.page} />
            ))}
            {ground.map((z, i) => (
              <g key={i}>
                <rect x={i === 4 ? 40 : 120} y={z + 6} width={i === 4 ? 880 : 730} height={46} fill="#04131b" opacity={0.42} filter="url(#pu-soft)" />
                <rect x={i === 4 ? 66 : 330} y={z - 2} width={i === 4 ? 810 : 280} height={18} fill={PU.card} />
                <path d={`M${i === 4 ? 66 : 330},${z + 16} h${i === 4 ? 810 : 280}`} {...fold} />
              </g>
            ))}
            <rect width={W - 72} height={526} fill="url(#pu-gut)" />
          </svg>
        </div>

        {/* back page */}
        <Card z={0} lean={lean} bright={bright} shadow={false}>
          <rect x={14} y={70} width={W - 28} height={LH - 70} fill="#7a2a22" rx={14} />
          <rect x={36} y={92} width={W - 72} height={LH - 92} fill={PU.card} />
          <rect x={58} y={112} width={W - 116} height={LH - 130} fill={PU.page} />
          <g opacity={0.9}>
            {Array.from({ length: 18 }, (_, i) => {
              const a = (i / 18) * 6.283;
              return <path key={i} d={`M${540 + Math.cos(a) * 216},${470 + Math.sin(a) * 216} L${540 + Math.cos(a + 0.09) * 372},${470 + Math.sin(a + 0.09) * 372} L${540 + Math.cos(a - 0.09) * 372},${470 + Math.sin(a - 0.09) * 372} Z`} fill={PU.pageL} />;
            })}
            <circle cx={540} cy={470} r={196} fill={PU.sun} />
          </g>
          <rect x={36} y={LH - 40} width={W - 72} height={40} fill="#000" opacity={0.28} />
        </Card>

        {/* stall card with a die-cut arch */}
        <Card z={90} lean={lean} bright={bright}>
          <path d="M92,1100 V420 Q540,130 988,420 V1100 H756 V640 Q540,380 324,640 V1100 Z" fill={PU.wall} {...edge} />
          <path d="M92,420 Q540,130 988,420 L988,500 Q540,214 92,500 Z" fill={PU.red} />
          {[150, 270, 390, 510, 630, 750, 870].map((x, i) => <circle key={i} cx={x} cy={x < 540 ? 390 - (x - 92) * 0.46 + 60 : 390 - (988 - x) * 0.46 + 60} r={15} fill={PU.card} />)}
          {[160, 228, 852, 920].map((x) => (
            <g key={x}>
              {[640, 740, 840, 940].map((y) => <rect key={y} x={x - 24} y={y} width={48} height={70} fill={PU.wallD} />)}
            </g>
          ))}
        </Card>

        {/* cup's far wall: rim and chai */}
        <Card z={170} lean={lean} bright={bright}>
          <path d={P.rim} fill="#e79468" {...edge} />
          <ellipse cx={540} cy={806} rx={150} ry={31} fill="#4a1e10" />
          <clipPath id="pu-rim"><path d={P.rim} /></clipPath>
          <g clipPath="url(#pu-rim)">
            {s.level > 0 ? (
              <>
                <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={PU.chai} />
                <ellipse cx={s.surface.cx - 40} cy={s.surface.cy - 8} rx={60} ry={8} fill={PU.chaiL} />
              </>
            ) : null}
          </g>
        </Card>

        {/* kettle card on a pull strip, and the paper stream */}
        <Card z={215} lean={lean} bright={bright}>
          {s.streaming ? (
            <>
              <path d={s.stream} fill="none" stroke={PU.card} strokeWidth={32} strokeLinecap="butt" />
              <path d={s.stream} fill="none" stroke={PU.chai} strokeWidth={22} strokeLinecap="butt" />
              {[0.2, 0.4, 0.6, 0.8].map((t, i) => {
                const pt = quadAt(q, t);
                return <path key={i} d={`M${pt.x - 11},${pt.y} h22`} stroke={PU.chaiL} strokeWidth={4} strokeDasharray="6 4" />;
              })}
            </>
          ) : null}
          <g transform={`translate(${s.kx} ${s.ky})`}>
            <rect x={0} y={-16} width={1100} height={32} fill={PU.card} stroke="#d2c7ae" strokeWidth={2} />
            <g transform={`rotate(${s.tilt})`}>
              <path d={P.kettleHandle} fill="none" stroke={PU.card} strokeWidth={42} strokeLinecap="round" />
              <path d={P.kettleHandle} fill="none" stroke={PU.ink} strokeWidth={22} strokeLinecap="round" />
              <path d={P.kettleSpout} fill={PU.steelD} {...edge} />
              <path d={P.kettleBody} fill={PU.steel} {...edge} />
              <path d="M18,-92 C60,-80 150,-20 150,60 C150,110 120,140 90,140 L18,140 Z" fill={PU.steelD} />
              <path d={P.kettleBand} fill="none" stroke={PU.sun} strokeWidth={15} />
              <path d={P.kettleLid} fill={PU.red} {...edge} />
              <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill={PU.sun} {...edge} />
              <circle cx={0} cy={0} r={15} fill="#c79a3b" stroke="#8b6a22" strokeWidth={4} />
              <path d="M-9,-5 L9,5 M-9,5 L9,-5" stroke="#8b6a22" strokeWidth={3} />
            </g>
          </g>
        </Card>

        {/* paper steam curls, between the cup walls */}
        <Card z={232} lean={lean} bright={bright}>
          {s.steam.map((p, i) => p > 0 ? (
            <g key={i}>
              <path d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#d8cfba" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" transform="translate(-4 3)" />
              <path d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#fffdf6" strokeWidth={25} strokeLinecap="round" strokeLinejoin="round" />
              <path d={steamPath(i, p, sf * 0.05)} fill="none" stroke="#b9ad97" strokeWidth={2.5} strokeDasharray="10 8" />
            </g>
          ) : null)}
        </Card>

        {/* cup's near wall: hides the end of the stream */}
        <Card z={240} lean={lean} bright={bright}>
          <path d="M416,1100 H664 L655,1040 H425 Z" fill={PU.leafD} {...edge} />
          <path d={P.kulhadBody} fill={PU.clay} {...edge} />
          <path d="M556,840 C600,840 660,812 710,800 L655,1040 Q600,1060 556,1060 Z" fill={PU.clayD} />
          <path d="M404,926 Q540,966 676,926" fill="none" stroke={PU.sun} strokeWidth={12} />
          {[440, 490, 540, 590, 640].map((x, i) => <circle key={i} cx={x} cy={978 + Math.abs(540 - x) * -0.05} r={8} fill={PU.card} />)}
        </Card>

        {/* foreground bushes */}
        <Card z={350} lean={lean} bright={bright}>
          <path d="M40,1100 V1000 C80,930 150,960 170,1010 C210,950 300,970 320,1040 C400,1000 430,1040 450,1070 L630,1070 C650,1030 700,1000 760,1040 C790,960 880,950 910,1010 C950,950 1020,950 1040,1000 V1100 Z" fill={PU.leaf} {...edge} />
          <path d="M92,1100 V1040 C130,1000 170,1020 190,1060 C240,1020 290,1050 300,1100 Z M790,1100 C800,1040 850,1020 890,1060 C920,1020 970,1020 990,1060 V1100 Z" fill={PU.leafD} />
          {[[120, 985], [250, 1018], [840, 1006], [980, 985]].map(([x, y], i) => (
            <g key={i}>
              {[0, 1, 2, 3, 4, 5].map((k) => <circle key={k} cx={x + Math.cos(k * 1.047) * 16} cy={y + Math.sin(k * 1.047) * 16} r={11} fill={i % 2 ? PU.sun : PU.card} />)}
              <circle cx={x} cy={y} r={9} fill={PU.red} />
            </g>
          ))}
        </Card>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <filter id="pu-grain" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.65} numOctaves={3} seed={5} />
          <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 1.4 -0.62" />
        </filter>
        <rect width={W} height={H} filter="url(#pu-grain)" opacity={0.22} />
      </svg>
    </AbsoluteFill>
  );
};

/* ---------- 27 Shadow puppet: black jointed leather behind a lamp-lit cloth, rods and all ---------- */
const SP = { ink: "#0d0907", light: "#f0cf91" };
const SP_KETTLE_HOLES = (() => {
  let d = rosette(-6, 8, 20, 54, 13, 10) + circlePath(-6, 8, 11);
  for (let x = -112; x <= 112; x += 28) d += petal(x, 116, -90, 26, 7);
  for (let i = -3; i <= 3; i++) d += diamond(i * 30, -58, 8, 11);
  return d;
})();
const SP_CUP_BODY = (() => {
  let d = P.kulhadBody + " M430,866 L650,866 L622,1012 Q540,1032 458,1012 Z ";
  for (let x = 408; x <= 672; x += 33) d += petal(x, 858, -90, 0.1, 0.1) + diamond(x, 846 + (Math.abs(x - 540) * Math.abs(x - 540)) * -0.00038, 7, 10);
  return d;
})();
const SP_GROUND = (() => {
  const n = 22;
  let top = "M0,1092 ";
  for (let i = 0; i < n; i++) top += `Q${(i + 0.5) * (W / n)},${1058 + (i % 2) * 14} ${(i + 1) * (W / n)},1092 `;
  let d = `${top} V1350 H0 Z `;
  for (let x = 40; x < W; x += 72) d += petal(x, 1176, -90, 62, 18) + diamond(x + 36, 1146, 9, 16);
  return d;
})();
const SP_TREE_LEAVES = (() => {
  const pts = [[132, 450, -160], [150, 396, -120], [188, 360, -80], [238, 372, -40], [266, 424, -8], [118, 520, 180], [276, 492, 8], [160, 470, -130], [232, 460, -40], [196, 422, -90]];
  return pts.map(([x, y, a]) => petal(x, y, a, 96, 30) + petal(x + Math.cos((a * Math.PI) / 180) * 26, y + Math.sin((a * Math.PI) / 180) * 26, a, 46, 8)).join("");
})();

export const ShadowPuppet: React.FC = () => {
  const f = useCurrentFrame();
  const s = storyAt(f);
  const q = parseStream(s.stream);
  const lamp = noise(f * 0.34, 7) * 0.65 + noise(f * 1.1, 8) * 0.35;
  const hand = (a: number, k: number) => (noise(f * 0.5, a) - 0.5) * k;
  const depth = interpolate(s.kx, [796, 1356], [0, 1], clamp);
  const blur = 0.7 + depth * depth * 18;
  const spread = 1 + depth * 0.2;
  const jx = hand(1, 5);
  const jy = hand(2, 6);
  const swingT = Math.sin(f * 0.1) * 1.6 + (s.streaming ? 1.2 : 0) + hand(3, 3);
  const lidT = s.tilt * 0.22 + hand(4, 4);
  const handleT = -s.tilt * 0.08 + Math.sin(f * 0.13) * 2.2;
  const treeSway = Math.sin(f * 0.04) * 1.6 + hand(5, 1.2);
  const beads = (() => {
    const len = Math.hypot(q.x2 - q.x1, q.y2 - q.y1);
    const n = Math.max(1, Math.round(len / 34));
    return Array.from({ length: n + 1 }, (_, i) => quadAt(q, Math.min(1, (i + ((f * 0.22) % 1)) / n)));
  })();
  const windowTop = 1012 - (1012 - 866) * s.level;
  const pinFill = SP.light;
  return (
    <Stage bg="#20140c" defs={
      <>
        <radialGradient id="sp-cloth" gradientUnits="userSpaceOnUse" cx={560 + lamp * 16} cy={620} r={800}>
          <stop offset="0%" stopColor="#fff2c6" /><stop offset="40%" stopColor="#f6d08a" /><stop offset="78%" stopColor="#cc8537" /><stop offset="100%" stopColor="#7f4216" />
        </radialGradient>
        <filter id="sp-weave" {...region}>
          <feTurbulence type="turbulence" baseFrequency="0.55 0.9" numOctaves={1} seed={11} />
          <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 0 0.08  0 0 0 1.5 -0.55" />
        </filter>
        <filter id="sp-k" x="-300" y="-300" width="2200" height="2200" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation={blur} /></filter>
        <filter id="sp-near" {...region}><feGaussianBlur stdDeviation={0.8} /></filter>
        <filter id="sp-smoke" {...region}><feGaussianBlur stdDeviation={7} /></filter>
        <clipPath id="sp-screen"><rect x={52} y={60} width={W - 104} height={1190} rx={6} /></clipPath>
        <clipPath id="sp-win"><path d="M430,866 L650,866 L622,1012 Q540,1032 458,1012 Z" /></clipPath>
        <clipPath id="sp-rim"><path d={P.rim} /></clipPath>
      </>
    }>
      <rect width={W} height={H} fill="#20140c" />
      <rect x={18} y={26} width={W - 36} height={1258} rx={10} fill="#4a2a14" />
      <rect x={38} y={46} width={W - 76} height={1218} fill="#120a05" />
      <g clipPath="url(#sp-screen)">
        <rect width={W} height={H} fill="url(#sp-cloth)" />
        <rect width={W} height={H} fill="#7f4216" opacity={0.03 + lamp * 0.14} />

        <g filter="url(#sp-near)">
          {/* a tree on its own stick, jointed at the trunk */}
          <path d="M196,1100 C190,960 214,860 196,740 L176,740 C196,860 170,960 170,1100 Z" fill={SP.ink} />
          <g transform={`rotate(${treeSway} 188 740)`}>
            <path d="M176,744 C190,640 184,560 196,470 L206,472 C204,560 208,640 202,744 Z" fill={SP.ink} />
            <path d={SP_TREE_LEAVES} fill={SP.ink} fillRule="evenodd" />
          </g>
          <circle cx={188} cy={740} r={7} fill={pinFill} />
          <path d="M184,1100 L200,1300" stroke={SP.ink} strokeWidth={7} />

          <path d={SP_GROUND} fill={SP.ink} fillRule="evenodd" />

          {/* cup puppet, with a window the chai rises behind */}
          <g transform={`translate(${hand(6, 3)} ${hand(7, 3)})`}>
            <path d="M540,1050 L566,1320" stroke={SP.ink} strokeWidth={8} />
            <path d={SP_CUP_BODY} fill={SP.ink} fillRule="evenodd" />
            <g clipPath="url(#sp-win)">
              <path d={`M400,${windowTop} Q450,${windowTop - 9} 500,${windowTop} T600,${windowTop} T700,${windowTop} V1060 H400 Z`} fill={SP.ink} />
            </g>
            <path d="M490,862 V1022 M540,862 V1028 M590,862 V1022" stroke={SP.ink} strokeWidth={5} />
            <path d={P.rim + " M390,804 A150,31 0 1,0 690,804 A150,31 0 1,0 390,804 Z"} fill={SP.ink} fillRule="evenodd" />
            <g clipPath="url(#sp-rim)">
              {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx - 8} ry={s.surface.ry - 3} fill={SP.ink} /> : null}
            </g>
            <circle cx={392} cy={830} r={6} fill={pinFill} />
            <circle cx={688} cy={830} r={6} fill={pinFill} />
          </g>

          {/* stream: a string of cut beads */}
          {s.streaming ? (
            <g>
              <path d={s.stream} fill="none" stroke={SP.ink} strokeWidth={7} strokeLinecap="round" />
              {beads.map((b, i) => <ellipse key={i} cx={b.x + Math.sin(i + f * 0.3) * 2.5} cy={b.y} rx={10} ry={16} fill={SP.ink} />)}
            </g>
          ) : null}
        </g>

        {/* kettle puppet: goes soft and large when it leaves the cloth */}
        <g filter="url(#sp-k)">
          <g transform={`translate(${s.kx + jx} ${s.ky + jy})`}>
            <path d={`M30,120 L${240 + depth * 80},${980}`} stroke={SP.ink} strokeWidth={8} />
            <g transform={`rotate(${s.tilt}) scale(${spread})`}>
              <g transform={`rotate(${handleT} 140 -42)`}>
                <path d={P.kettleHandle} fill="none" stroke={SP.ink} strokeWidth={24} strokeLinecap="round" />
              </g>
              <g transform={`rotate(${swingT} -134 -8)`}>
                <path d={P.kettleSpout + petal(-190, -6, -152, 42, 6)} fill={SP.ink} fillRule="evenodd" />
                <circle cx={-134} cy={-8} r={7} fill={pinFill} />
              </g>
              <path d={P.kettleBody + SP_KETTLE_HOLES} fill={SP.ink} fillRule="evenodd" />
              <g transform={`rotate(${lidT} -92 -86)`}>
                <path d={P.kettleLid} fill={SP.ink} />
                <path d="M-92,-90 L92,-90 L92,-82 L-92,-82 Z" fill={SP.ink} />
                <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r} fill={SP.ink} />
                <circle cx={-92} cy={-86} r={6} fill={pinFill} />
              </g>
              <circle cx={140} cy={-42} r={7} fill={pinFill} />
              <circle cx={140} cy={92} r={7} fill={pinFill} />
            </g>
          </g>
        </g>

        {s.steam.map((p, i) =>
          p > 0 ? <path key={i} d={steamPath(i, p, f * 0.05)} fill="none" stroke={SP.ink} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" opacity={0.74} filter="url(#sp-smoke)" /> : null,
        )}

        <rect width={W} height={H} filter="url(#sp-weave)" opacity={0.4} />
      </g>
      {/* stage lip hides the puppeteers' hands */}
      <rect x={18} y={1248} width={W - 36} height={90} fill="#3a2110" />
      <rect x={18} y={1248} width={W - 36} height={8} fill="#8a5a2a" />
    </Stage>
  );
};
