import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage, region } from "../../kit";
import { H, KNOB, P, W, steamPath, storyAt } from "../../story";
import { Raster, Story, clamp01, gray, inKettle, layer, paths, pts, ribbon, rng, spiral, wedge } from "./util";
/* ---------- 28 Woodcut: one black block on cream, every light area gouged out by hand ---------- */
const WC_INK = "#14110e";
const WC_PAPER = "#e9dfc8";

const WC_SKY = (() => {
  const r = rng(2801);
  let d = "";
  for (let ring = 0; ring < 22; ring++) {
    const rad = 250 + ring * 52;
    const count = 22 + ring * 5;
    for (let i = 0; i < count; i++) {
      const a = ((i + (ring % 2) * 0.5 + (r() - 0.5) * 0.5) / count) * Math.PI * 2;
      const len = 26 + r() * 40 + ring * 2.2;
      const x0 = 540 + Math.cos(a) * rad;
      const y0 = 800 + Math.sin(a) * rad;
      const x1 = 540 + Math.cos(a) * (rad + len);
      const y1 = 800 + Math.sin(a) * (rad + len);
      if (y1 > 955 || y0 > 955) continue;
      d += wedge(x0, y0, x1, y1, 3 + r() * 3.5 + ring * 0.16);
    }
  }
  return d;
})();

const WC_TABLE = (() => {
  const r = rng(2802);
  let d = "";
  for (let y = 985; y < 1285; y += 15) {
    let x = 40 - r() * 80;
    while (x < 1060) {
      const len = 70 + r() * 210;
      const cy = y + (r() - 0.5) * 5;
      const nearCup = cy < 1115 && x + len > 300 && x < 780;
      if (!nearCup) d += wedge(x, cy, x + len, cy + (r() - 0.5) * 6, 2.5 + ((y - 985) / 300) * 4 + r() * 2);
      x += len + 14 + r() * 24;
    }
  }
  return d;
})();

// Cuts follow the round of the cup: dark on the right, a few nicks on the left.
const WC_CUP_CUTS = (() => {
  const r = rng(2803);
  let d = "";
  for (let y = 852; y < 1062; y += 13) {
    const t = (y - 800) / 240;
    const edge = 710 - t * 55;
    const sag = 34 * Math.sqrt(Math.max(0, 1 - ((edge - 540) / 175) ** 2));
    const len = 170 + r() * 90 - t * 30;
    d += wedge(edge + 6, y + sag * 0.4, edge - len, y + 30, 5 + r() * 2.5);
  }
  for (let y = 868; y < 1040; y += 34) {
    const t = (y - 800) / 240;
    const edge = 370 + t * 55;
    d += wedge(edge - 4, y, edge + 40 + r() * 44, y + 13, 3.5);
  }
  return d;
})();

const WC_KETTLE_CUTS = (() => {
  const r = rng(2804);
  let d = "";
  for (let y = -62; y < 144; y += 12) {
    const len = 105 + r() * 90 + (y > 60 ? 70 : 0);
    d += wedge(178, y, 178 - len, y + 22 + r() * 10, 4.5 + r() * 2);
  }
  for (let y = -46; y < 128; y += 31) d += wedge(-178, y, -118 - r() * 22, y + 12, 3);
  return d;
})();

const WC_HANDLE_CUTS = (() => {
  let d = "";
  for (let i = 0; i < 11; i++) {
    const a = -1.2 + (i / 10) * 2.4;
    const cx = 170 + Math.cos(a) * 62;
    const cy = 22 + Math.sin(a) * 62;
    d += wedge(cx - Math.cos(a) * 13, cy - Math.sin(a) * 13, cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 3);
  }
  return d;
})();

export const Woodcut: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 3) * 3;
  const s = storyAt(sf);
  const seed = (Math.floor(sf / 3) % 4) + 1;
  const ripple = s.level > 0 ? (
    <g clipPath="url(#wc-surf)">
      {[0.36, 0.62, 0.86].map((k, i) => (
        <ellipse key={i} cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx * k} ry={s.surface.ry * k} fill="none" stroke={WC_INK}
          strokeWidth={5.5} strokeDasharray={`${70 - i * 8} 16`} strokeDashoffset={sf * 3 + i * 40} />
      ))}
    </g>
  ) : null;
  return (
    <Stage bg={WC_PAPER} defs={
      <>
        <filter id="wc-ink" {...region}>
          <feTurbulence type="fractalNoise" baseFrequency={0.05} numOctaves={3} seed={seed} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={8} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.0045 0.42" numOctaves={3} seed={31} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 5.1" result="grain" />
          <feTurbulence type="fractalNoise" baseFrequency={0.75} numOctaves={2} seed={seed + 40} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 4.2" result="spk" />
          <feComposite in="d" in2="grain" operator="out" result="a" />
          <feComposite in="a" in2="spk" operator="out" />
        </filter>
        <clipPath id="wc-rim"><path d={P.rim} /></clipPath>
        <clipPath id="wc-body"><path d={P.kulhadBody} /></clipPath>
        <clipPath id="wc-kettle"><path d={P.kettleBody} /></clipPath>
        <clipPath id="wc-surf"><ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} /></clipPath>
      </>
    }>
      <g filter="url(#wc-ink)">
        <rect x={46} y={46} width={W - 92} height={H - 92} fill={WC_INK} />
        <path d={WC_SKY} fill={WC_PAPER} />
        <path d="M46,960 L1034,960" stroke={WC_PAPER} strokeWidth={9} />
        <path d={WC_TABLE} fill={WC_PAPER} />

        <ellipse cx={540} cy={1062} rx={240} ry={38} fill={WC_INK} />
        <path d={P.kulhadBody} fill={WC_PAPER} stroke={WC_INK} strokeWidth={22} strokeLinejoin="round" />
        <g clipPath="url(#wc-body)"><path d={WC_CUP_CUTS} fill={WC_INK} /></g>
        <path d={P.kulhadOutline} fill="none" stroke={WC_INK} strokeWidth={9} />
        <path d={P.rim} fill={WC_INK} stroke={WC_PAPER} strokeWidth={13} />
        <path d={P.rim} fill="none" stroke={WC_INK} strokeWidth={3} />
        <g clipPath="url(#wc-rim)">
          {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={WC_PAPER} /> : null}
          {ripple}
        </g>

        {s.streaming ? (
          <>
            <path d={s.stream} fill="none" stroke={WC_INK} strokeWidth={46} strokeLinecap="round" />
            <path d={s.stream} fill="none" stroke={WC_PAPER} strokeWidth={28} strokeLinecap="butt" />
            <path d={s.stream} fill="none" stroke={WC_INK} strokeWidth={6} strokeDasharray="42 30" strokeDashoffset={-sf * 8} transform="translate(-5 0)" />
            <path d={s.stream} fill="none" stroke={WC_INK} strokeWidth={4} strokeDasharray="26 44" strokeDashoffset={-sf * 8 + 30} transform="translate(6 0)" />
          </>
        ) : null}

        <g transform={`translate(${s.kx} ${s.ky}) rotate(${s.tilt})`}>
          <path d={P.kettleHandle} fill="none" stroke={WC_INK} strokeWidth={62} strokeLinecap="round" />
          <path d={P.kettleHandle} fill="none" stroke={WC_PAPER} strokeWidth={36} strokeLinecap="round" />
          <path d={WC_HANDLE_CUTS} fill={WC_INK} />
          <path d={P.kettleSpout} fill={WC_PAPER} stroke={WC_INK} strokeWidth={22} strokeLinejoin="round" />
          <path d={wedge(-250, -58, -160, -14, 6) + wedge(-214, -36, -152, 4, 5)} fill={WC_INK} />
          <path d={P.kettleBody} fill={WC_PAPER} stroke={WC_INK} strokeWidth={24} strokeLinejoin="round" />
          <g clipPath="url(#wc-kettle)"><path d={WC_KETTLE_CUTS} fill={WC_INK} /></g>
          <path d={P.kettleBand} fill="none" stroke={WC_INK} strokeWidth={22} />
          <path d={P.kettleBand} fill="none" stroke={WC_PAPER} strokeWidth={5} strokeDasharray="22 16" />
          <path d={P.kettleLid} fill={WC_PAPER} stroke={WC_INK} strokeWidth={20} strokeLinejoin="round" />
          <path d={P.kettleLid} fill={WC_PAPER} stroke={WC_PAPER} strokeWidth={6} strokeLinejoin="round" />
          <path d={wedge(10, -128, 84, -92, 5) + wedge(-6, -126, 56, -92, 4)} fill={WC_INK} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 12} fill={WC_INK} />
          <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 1} fill={WC_PAPER} />
          <path d={wedge(0, KNOB.y - 12, 8, KNOB.y + 12, 4)} fill={WC_INK} />
        </g>

        {s.steam.map((p, i) => {
          if (p <= 0) return null;
          const line = pts(steamPath(i, p, sf * 0.05));
          return (
            <g key={i}>
              <path d={ribbon(line, 58, 30)} fill={WC_INK} />
              <path d={ribbon(line, 40, 9)} fill={WC_PAPER} />
              <path d={ribbon(line.slice(4, Math.max(5, line.length - 6)), 4, 7)} fill={WC_INK} />
            </g>
          );
        })}
      </g>
    </Stage>
  );
};

/* ---------- 29 Engraving: a banknote vignette, tone carried only by the width of fine parallel lines ---------- */
const EN_INK: [number, number, number] = [18, 56, 48];
const EN_S = 0.84;
const EN_OX = 86.4;
const EN_OY = 90;
const EN_FRAME = { x0: 80, x1: 1000, y0: 80, y1: 1270 };

const rope = (x0: number, y0: number, x1: number, y1: number, amp: number, strands: number, waves: number) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  let d = "";
  for (let s = 0; s < strands; s++) {
    const ph = (s / strands) * Math.PI * 2;
    for (let k = 0; k <= 800; k++) {
      const t = k / 800;
      const off = Math.sin(t * waves * Math.PI * 2 + ph) * amp;
      d += `${k ? "L" : "M"}${(x0 + ux * len * t - uy * off).toFixed(1)},${(y0 + uy * len * t + ux * off).toFixed(1)} `;
    }
  }
  return d;
};

const rosette = (cx: number, cy: number, r0: number, a: number, petals: number, strands: number) => {
  let d = "";
  for (let s = 0; s < strands; s++) {
    const ph = (s / strands) * Math.PI * 2;
    for (let k = 0; k <= 720; k++) {
      const th = (k / 720) * Math.PI * 2;
      const r = r0 + a * Math.sin(th * petals + ph);
      d += `${k ? "L" : "M"}${(cx + Math.cos(th) * r).toFixed(1)},${(cy + Math.sin(th) * r).toFixed(1)} `;
    }
  }
  return d;
};

const EN_ROPES = [
  rope(56, 54, 1024, 54, 15, 6, 52),
  rope(56, 1296, 1024, 1296, 15, 6, 52),
  rope(54, 56, 54, 1294, 15, 6, 66),
  rope(1026, 56, 1026, 1294, 15, 6, 66),
].join("");
const EN_CORNERS = [
  [64, 64],
  [1016, 64],
  [64, 1286],
  [1016, 1286],
].map(([x, y]) => rosette(x, y, 30, 18, 9, 9));
const EN_UNDER = rosette(540, 610, 380, 96, 16, 14);

const engrave = (out: CanvasRenderingContext2D, s: Story, sf: number) => {
  const T = layer("en-t", W, H);
  const I = layer("en-i", W, H);
  const p = paths();
  const tf = (c: CanvasRenderingContext2D) => c.setTransform(EN_S, 0, 0, EN_S, EN_OX, EN_OY);

  T.fillStyle = "#fff";
  T.fillRect(0, 0, W, H);
  tf(T);
  tf(I);
  const id = (n: number) => `rgb(${n * 20},0,0)`;

  const bg = T.createRadialGradient(560, 540, 90, 540, 600, 860);
  bg.addColorStop(0, gray(0.14));
  bg.addColorStop(0.55, gray(0.3));
  bg.addColorStop(1, gray(0.74));
  T.fillStyle = bg;
  T.fillRect(-200, -200, 1500, 1200);

  const tb = T.createLinearGradient(0, 950, 0, 1330);
  tb.addColorStop(0, gray(0.34));
  tb.addColorStop(1, gray(0.82));
  T.fillStyle = tb;
  T.fillRect(-200, 950, 1500, 700);
  I.fillStyle = id(5);
  I.fillRect(-200, 950, 1500, 700);
  T.fillStyle = gray(1);
  T.fillRect(-200, 947, 1500, 5);

  T.save();
  T.filter = "blur(10px)";
  T.fillStyle = gray(0.92);
  T.beginPath();
  T.ellipse(590, 1064, 230, 34, 0, 0, Math.PI * 2);
  T.fill();
  T.restore();

  const cg = T.createLinearGradient(370, 0, 710, 0);
  cg.addColorStop(0, gray(0.62));
  cg.addColorStop(0.2, gray(0.14));
  cg.addColorStop(0.42, gray(0.06));
  cg.addColorStop(0.75, gray(0.56));
  cg.addColorStop(1, gray(0.96));
  T.fillStyle = cg;
  T.fill(p.kulhadBody);
  T.strokeStyle = gray(1);
  T.lineWidth = 5;
  T.stroke(p.kulhadOutline);
  I.fillStyle = id(2);
  I.fill(p.kulhadBody);

  T.fillStyle = gray(0.86);
  T.fill(p.rim);
  I.fillStyle = id(3);
  I.fill(p.rim);
  if (s.level > 0) {
    T.save();
    T.clip(p.rim);
    const sg = T.createRadialGradient(s.surface.cx - 50, s.surface.cy - 8, 8, s.surface.cx, s.surface.cy, s.surface.rx);
    sg.addColorStop(0, gray(0.22));
    sg.addColorStop(1, gray(0.7));
    T.fillStyle = sg;
    T.beginPath();
    T.ellipse(s.surface.cx, s.surface.cy, s.surface.rx, s.surface.ry, 0, 0, Math.PI * 2);
    T.fill();
    T.strokeStyle = gray(1);
    T.lineWidth = 3;
    T.stroke();
    T.restore();
  }
  T.strokeStyle = gray(1);
  T.lineWidth = 5;
  T.stroke(p.rim);

  if (s.streaming) {
    const st = new Path2D(s.stream);
    T.strokeStyle = gray(1);
    T.lineWidth = 25;
    T.stroke(st);
    T.strokeStyle = gray(0.3);
    T.lineWidth = 19;
    T.stroke(st);
    I.strokeStyle = id(4);
    I.lineWidth = 25;
    I.stroke(st);
  }

  const kettleTone = () => {
    const b = T.createLinearGradient(-165, -60, 165, 90);
    b.addColorStop(0, gray(0.5));
    b.addColorStop(0.2, gray(0.03));
    b.addColorStop(0.38, gray(0.12));
    b.addColorStop(0.72, gray(0.7));
    b.addColorStop(1, gray(0.98));
    T.strokeStyle = gray(1);
    T.lineWidth = 40;
    T.lineCap = "round";
    T.stroke(p.kettleHandle);
    T.strokeStyle = gray(0.42);
    T.lineWidth = 30;
    T.stroke(p.kettleHandle);
    T.fillStyle = gray(0.48);
    T.fill(p.kettleSpout);
    T.strokeStyle = gray(1);
    T.lineWidth = 5;
    T.stroke(p.kettleSpout);
    T.fillStyle = b;
    T.fill(p.kettleBody);
    T.stroke(p.kettleBody);
    T.strokeStyle = gray(1);
    T.lineWidth = 9;
    T.stroke(p.kettleBand);
    T.fillStyle = gray(0.82);
    T.fill(p.kettleLid);
    T.lineWidth = 5;
    T.stroke(p.kettleLid);
    T.fillStyle = gray(0.4);
    T.beginPath();
    T.arc(KNOB.x, KNOB.y, KNOB.r, 0, Math.PI * 2);
    T.fill();
    T.stroke();
  };
  inKettle(T, s, kettleTone);
  inKettle(I, s, () => {
    I.strokeStyle = id(1);
    I.lineWidth = 40;
    I.lineCap = "round";
    I.stroke(p.kettleHandle);
    I.fillStyle = id(1);
    I.fill(p.kettleSpout);
    I.fill(p.kettleBody);
    I.fill(p.kettleLid);
    I.beginPath();
    I.arc(KNOB.x, KNOB.y, KNOB.r + 3, 0, Math.PI * 2);
    I.fill();
  });

  s.steam.forEach((v, i) => {
    if (v <= 0) return;
    const d = new Path2D(steamPath(i, v, sf * 0.05));
    T.save();
    T.filter = "blur(5px)";
    T.lineCap = "round";
    T.strokeStyle = "rgba(255,255,255,0.92)";
    T.lineWidth = 30;
    T.stroke(d);
    T.restore();
    T.strokeStyle = "#fff";
    T.lineWidth = 13;
    T.lineCap = "round";
    T.stroke(d);
  });

  // Turn the tone picture into lines. Each region cuts its lines along its own form.
  const td = T.getImageData(0, 0, W, H).data;
  const rd = I.getImageData(0, 0, W, H).data;
  const img = out.createImageData(W, H);
  const o = img.data;
  const period = 6.6;
  const a0 = (-s.tilt * Math.PI) / 180;
  const ca = Math.cos(a0);
  const sa = Math.sin(a0);
  const tri = (v: number) => {
    const q = v - Math.floor(v);
    return q < 0.5 ? 1 - 2 * q : 2 * q - 1;
  };
  for (let y = EN_FRAME.y0; y < EN_FRAME.y1; y++) {
    const sy = (y - EN_OY) / EN_S;
    for (let x = EN_FRAME.x0; x < EN_FRAME.x1; x++) {
      const i = (y * W + x) * 4;
      const tone = 1 - td[i] / 255;
      const reg = Math.floor((rd[i] + 10) / 20);
      const sx = (x - EN_OX) / EN_S;
      let ph = 0;
      let ph2 = 0;
      if (reg === 1) {
        const dx = sx - s.kx;
        const dy = sy - s.ky;
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;
        ph = EN_S * (ly - 0.0019 * lx * lx);
        ph2 = EN_S * (lx + 0.0014 * ly * ly);
      } else if (reg === 2) {
        const nx = (sx - 540) / 186;
        ph = EN_S * (sy - 44 * Math.sqrt(Math.max(0, 1 - nx * nx)));
        ph2 = EN_S * ((sx - 540) * (1 + (sy - 800) * 0.0011));
      } else if (reg === 3) {
        const c = s.level > 0 ? s.surface : { cx: 540, cy: 820, rx: 170, ry: 42 };
        ph = 84 * Math.hypot((sx - c.cx) / c.rx, (sy - c.cy) / c.ry);
        ph2 = y;
      } else if (reg === 4) {
        ph = x * 0.8;
        ph2 = y;
      } else if (reg === 5) {
        ph = y;
        ph2 = x * 0.7 + y * 0.7;
      } else {
        ph = y + 1.6 * Math.sin(x * 0.014);
        ph2 = x;
      }
      let a = clamp01((tone - tri(ph / period)) * period * 0.5 + 0.5);
      if (tone > 0.58) {
        const t2 = ((tone - 0.58) / 0.42) * 0.8;
        const a2 = clamp01((t2 - tri(ph2 / period)) * period * 0.5 + 0.5);
        if (a2 > a) a = a2;
      }
      o[i] = EN_INK[0];
      o[i + 1] = EN_INK[1];
      o[i + 2] = EN_INK[2];
      o[i + 3] = a * 255;
    }
  }
  out.putImageData(img, 0, 0);
};

export const Engraving: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  return (
    <AbsoluteFill style={{ background: "#e9ecd9" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <path d={EN_UNDER} fill="none" stroke="#d4a3a0" strokeWidth={1.5} opacity={0.75} />
      </svg>
      <Raster frame={sf} width={W} height={H} paint={(c) => engrave(c, s, sf)} />
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <rect x={EN_FRAME.x0} y={EN_FRAME.y0} width={EN_FRAME.x1 - EN_FRAME.x0} height={EN_FRAME.y1 - EN_FRAME.y0} fill="none" stroke="#123830" strokeWidth={4} />
        <rect x={32} y={32} width={W - 64} height={H - 64} fill="none" stroke="#123830" strokeWidth={3} />
        <path d={EN_ROPES} fill="none" stroke="#123830" strokeWidth={1.4} />
        {EN_CORNERS.map((d, i) => (
          <g key={i}>
            <circle cx={i % 2 ? 1016 : 64} cy={i < 2 ? 64 : 1286} r={50} fill="#e9ecd9" stroke="#123830" strokeWidth={2.5} />
            <path d={d} fill="none" stroke="#123830" strokeWidth={1.4} />
          </g>
        ))}
      </svg>
    </AbsoluteFill>
  );
};

/* ---------- 31 Silkscreen poster: opaque flat inks pulled one screen at a time, a shadow ink overprinted ---------- */
const SS = { paper: "#f3e6c7", gold: "#f3a61f", red: "#e4432a", teal: "#0b6e72", navy: "#172a53" };

const raysPath = (cx: number, cy: number, n: number, spin: number) => {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = spin + (i / n) * Math.PI * 2;
    const a1 = spin + ((i + 0.5) / n) * Math.PI * 2;
    d += `M${cx},${cy} L${(cx + Math.cos(a0) * 1500).toFixed(1)},${(cy + Math.sin(a0) * 1500).toFixed(1)} L${(cx + Math.cos(a1) * 1500).toFixed(1)},${(cy + Math.sin(a1) * 1500).toFixed(1)} Z `;
  }
  return d;
};

const SS_SCALLOP = (() => {
  let d = "";
  for (let i = 0; i < 12; i++) {
    const x = 70 + i * 78;
    d += `M${x},1100 a39,39 0 0,1 78,0 Z `;
  }
  return d;
})();
const SS_TEETH = (() => {
  let d = "M68,68 ";
  for (let i = 0; i < 24; i++) d += `L${68 + i * 39 + 19.5},112 L${68 + (i + 1) * 39},68 `;
  return `${d}Z`;
})();
const SS_DOTS = Array.from({ length: 12 }, (_, i) => 109 + i * 78);

const SsLayer: React.FC<{ seed: number; dx?: number; dy?: number; multiply?: boolean; children: React.ReactNode }> = ({ seed, dx = 0, dy = 0, multiply, children }) => (
  <g filter={`url(#ss-m${seed})`} transform={`translate(${dx} ${dy})`} style={multiply ? { mixBlendMode: "multiply" } : undefined}>
    {children}
  </g>
);

export const Silkscreen: React.FC = () => {
  const f = useCurrentFrame();
  const sf = Math.floor(f / 2) * 2;
  const s = storyAt(sf);
  const r = rng(3100 + Math.floor(sf / 6));
  const j = () => r() * 3 - 1.5;
  const spin = Math.floor(sf / 2) * 0.012;
  const mesh = [1, 2, 3, 4].map((m) => (
    <filter key={m} id={`ss-m${m}`} {...region}>
      <feTurbulence type="fractalNoise" baseFrequency={0.62} numOctaves={2} seed={m * 13} />
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -13 4.2" result="salt" />
      <feComposite in="SourceGraphic" in2="salt" operator="out" />
    </filter>
  ));
  const kettle = `translate(${s.kx} ${s.ky}) rotate(${s.tilt})`;
  const steam = s.steam.map((p, i) => (p > 0 ? pts(steamPath(i, p, sf * 0.05)) : null));
  const head = (line: { x: number; y: number }[], i: number) => {
    const e = line[line.length - 1];
    return spiral(e.x, e.y - 22, 34, 1.3, Math.PI / 2, i === 1 ? -1 : 1);
  };
  return (
    <Stage bg={SS.paper} defs={
      <>
        {mesh}
        <clipPath id="ss-rim"><path d={P.rim} /></clipPath>
        <clipPath id="ss-print"><rect x={60} y={60} width={W - 120} height={H - 120} /></clipPath>
      </>
    }>
      <g clipPath="url(#ss-print)">
        <SsLayer seed={1} dx={j()} dy={j()}>
          <rect x={60} y={60} width={W - 120} height={H - 120} fill={SS.gold} />
        </SsLayer>
        <SsLayer seed={2} dx={j()} dy={j()}>
          <path d={raysPath(540, 640, 14, spin)} fill={SS.red} />
        </SsLayer>
        <SsLayer seed={3} dx={j()} dy={j()}>
          <circle cx={540} cy={640} r={420} fill={SS.paper} />
          <circle cx={540} cy={640} r={392} fill="none" stroke={SS.navy} strokeWidth={11} />
          <rect x={60} y={1100} width={W - 120} height={200} fill={SS.teal} />
          <path d={SS_SCALLOP} fill={SS.teal} />
          {SS_DOTS.map((x) => <circle key={x} cx={x} cy={1088} r={12} fill={SS.gold} />)}
          <path d={P.kulhadBody} fill={SS.red} />
          <path d={P.rim} fill={SS.navy} />
          <g clipPath="url(#ss-rim)">
            {s.level > 0 ? <ellipse cx={s.surface.cx} cy={s.surface.cy} rx={s.surface.rx} ry={s.surface.ry} fill={SS.gold} /> : null}
          </g>
          {s.streaming ? (
            <>
              <path d={s.stream} fill="none" stroke={SS.navy} strokeWidth={38} strokeLinecap="round" />
              <path d={s.stream} fill="none" stroke={SS.gold} strokeWidth={20} strokeLinecap="round" />
            </>
          ) : null}
        </SsLayer>
        <SsLayer seed={4} dx={j()} dy={j()}>
          <g transform={kettle}>
            <path d={P.kettleHandle} fill="none" stroke={SS.navy} strokeWidth={34} strokeLinecap="round" />
            <path d={P.kettleSpout} fill={SS.teal} />
            <path d={P.kettleBody} fill={SS.teal} />
            <path d={P.kettleBand} fill="none" stroke={SS.gold} strokeWidth={26} />
            <path d={P.kettleLid} fill={SS.navy} />
            <circle cx={KNOB.x} cy={KNOB.y} r={KNOB.r + 6} fill={SS.red} />
            <path d="M-108,-40 C-126,10 -122,70 -96,110" fill="none" stroke={SS.paper} strokeWidth={20} strokeLinecap="round" />
          </g>
          {steam.map((line, i) =>
            line ? (
              <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d={steamPath(i, s.steam[i], sf * 0.05)} stroke={SS.navy} strokeWidth={38} />
                <path d={head(line, i)} stroke={SS.navy} strokeWidth={22} />
                <path d={steamPath(i, s.steam[i], sf * 0.05)} stroke={SS.gold} strokeWidth={13} />
                <path d={head(line, i)} stroke={SS.gold} strokeWidth={7} />
              </g>
            ) : null,
          )}
          <path d={SS_TEETH} fill={SS.navy} />
          <rect x={60} y={1244} width={W - 120} height={18} fill={SS.gold} />
        </SsLayer>
        {/* Shadow screen: one transparent ink pulled last, across everything it touches. */}
        <SsLayer seed={2} dx={j()} dy={j()} multiply>
          <path d="M560,790 L710,800 L655,1040 Q600,1058 560,1062 Z" fill={SS.navy} opacity={0.55} />
          <ellipse cx={600} cy={1066} rx={210} ry={26} fill={SS.navy} opacity={0.55} />
          <g transform={kettle}>
            <path d="M16,-100 L130,-70 C172,40 152,132 90,140 L16,140 Z" fill={SS.navy} opacity={0.55} />
          </g>
        </SsLayer>
      </g>
      <rect x={60} y={60} width={W - 120} height={H - 120} fill="none" stroke={SS.navy} strokeWidth={8} />
    </Stage>
  );
};

