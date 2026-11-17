// 81 Microscope: brightfield eyepiece over the kulhad wall as chai floods across it. Only the surface is visible:
// the kettle is a passing shadow, the pour is droplets landing, the fill is the flood front, the steam is condensate rising.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { steamPath, storyAt } from "../../story";
import { Cv, hash, offscreen, pathPts } from "./core";

const LX = 540;
const LY = 675;
const LR = 486;
const FS = 972;

let plate: ReturnType<typeof offscreen> | null = null;
let flood: ReturnType<typeof offscreen> | null = null;
let field: ReturnType<typeof offscreen> | null = null;
let swirl: ReturnType<typeof offscreen> | null = null;

const buildSwirl = () => {
  const p = offscreen(1500, 1500);
  const c = p.c;
  c.filter = "blur(30px)";
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 91) * 1500;
    const y = hash(i, 92) * 1500;
    c.strokeStyle = `rgba(250,226,180,${0.14 + hash(i, 93) * 0.2})`;
    c.lineWidth = 30 + hash(i, 94) * 90;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x, y);
    c.bezierCurveTo(x + (hash(i, 95) - 0.5) * 700, y + (hash(i, 96) - 0.5) * 700, x + (hash(i, 97) - 0.5) * 700, y + (hash(i, 98) - 0.5) * 700, x + (hash(i, 99) - 0.5) * 600, y + (hash(i, 90) - 0.5) * 600);
    c.stroke();
  }
  c.filter = "blur(9px)";
  for (let i = 0; i < 70; i++) {
    c.fillStyle = `rgba(92,44,12,${0.16 + hash(i, 101) * 0.25})`;
    c.beginPath();
    c.arc(hash(i, 102) * 1500, hash(i, 103) * 1500, 20 + hash(i, 104) * 62, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 60; i++) {
    c.fillStyle = `rgba(255,236,196,${0.12 + hash(i, 105) * 0.2})`;
    c.beginPath();
    c.arc(hash(i, 106) * 1500, hash(i, 107) * 1500, 12 + hash(i, 108) * 40, 0, Math.PI * 2);
    c.fill();
  }
  c.filter = "none";
  return p;
};

// Bare clay seen up close: pale grains with dark seams, painted once.
const buildPlate = () => {
  const p = offscreen(1500, 1500);
  const c = p.c;
  c.fillStyle = "#e6d6b6";
  c.fillRect(0, 0, 1500, 1500);
  c.filter = "blur(26px)";
  for (let i = 0; i < 46; i++) {
    const t = hash(i, 16);
    c.fillStyle = `rgba(${176 + t * 50},${132 + t * 50},${84 + t * 50},0.5)`;
    c.beginPath();
    c.arc(hash(i, 17) * 1500, hash(i, 18) * 1500, 70 + hash(i, 19) * 130, 0, Math.PI * 2);
    c.fill();
  }
  c.filter = "none";
  for (let i = 0; i < 1500; i++) {
    const x = hash(i, 11) * 1500;
    const y = hash(i, 12) * 1500;
    const r = 5 + Math.pow(hash(i, 13), 2) * 22;
    const n = 6;
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i;
      const rr = r * (0.7 + hash(i, k, 14) * 0.6);
      const X = x + Math.cos(a) * rr;
      const Y = y + Math.sin(a) * rr * 0.72;
      if (k === 0) c.moveTo(X, Y);
      else c.lineTo(X, Y);
    }
    c.closePath();
    const t = hash(i, 15);
    if (t > 0.72) c.fillStyle = "rgba(252,240,214,0.75)";
    else if (t > 0.4) c.fillStyle = "rgba(182,128,80,0.5)";
    else c.fillStyle = "rgba(122,78,44,0.36)";
    c.fill();
  }
  c.strokeStyle = "rgba(92,58,30,0.34)";
  c.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    let x = hash(i, 31) * 1500;
    let y = hash(i, 32) * 1500;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (hash(i, k, 33) - 0.5) * 140;
      y += (hash(i, k, 34) - 0.5) * 140;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = `rgba(90,58,30,${hash(i, 22) * 0.34})`;
    c.fillRect(hash(i, 23) * 1500, hash(i, 24) * 1500, 2 + hash(i, 25) * 3, 2 + hash(i, 26) * 3);
  }
  return p;
};

// A globule: bright core, thin dark ring, soft halo, the way an oil drop reads under brightfield.
const globule = (c: CanvasRenderingContext2D, x: number, y: number, r: number, warm: number) => {
  const g = c.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
  g.addColorStop(0, "rgba(255,247,224,0.96)");
  g.addColorStop(0.62, `rgba(${236 - warm * 40},${196 - warm * 50},${128 - warm * 40},0.72)`);
  g.addColorStop(0.86, "rgba(70,38,12,0.78)");
  g.addColorStop(0.96, "rgba(255,226,170,0.55)");
  g.addColorStop(1, "rgba(255,226,170,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
};

const fragment = (c: CanvasRenderingContext2D, x: number, y: number, r: number, rotA: number, seed: number) => {
  const n = 11;
  c.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rotA;
    const rr = r * (0.5 + hash(seed, k, 3) * 0.7);
    const X = x + Math.cos(a) * rr;
    const Y = y + Math.sin(a) * rr;
    if (k === 0) c.moveTo(X, Y);
    else c.lineTo(X, Y);
  }
  c.closePath();
  c.fillStyle = `rgba(${52 + (seed % 5) * 8},${26 + (seed % 5) * 4},8,0.8)`;
  c.fill();
  c.strokeStyle = "rgba(255,214,150,0.32)";
  c.lineWidth = 2;
  c.stroke();
};

const dropRec = (j: number) => {
  const spawn = 42 + j * 3;
  return { spawn, land: spawn + 9, x0: 486 + (hash(j, 51) - 0.5) * 260, x1: 486 + (hash(j, 52) - 0.5) * 460, y1: 230 + hash(j, 53) * 480, r: 26 + hash(j, 54) * 26 };
};

const paintField = (c: CanvasRenderingContext2D, f: number) => {
  const s = storyAt(f);
  const pan = { x: f * 0.9, y: Math.sin(f * 0.03) * 14 + f * 0.25 };
  const flooded = s.level > 0 || f >= 44;
  if (!plate) plate = buildPlate();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.filter = "none";
  c.globalAlpha = 1;
  c.fillStyle = "#e6d6b6";
  c.fillRect(0, 0, FS, FS);
  c.drawImage(plate.el, -180 - pan.x, -180 - pan.y);

  // Flood front creeping out from where the first drops land
  const R = interpolate(s.level, [0, 0.08, 1], [40, 280, 1100]);
  const front = (a: number) => R * (1 + 0.09 * Math.sin(a * 5 + f * 0.05) + 0.04 * Math.sin(a * 11 - f * 0.04) + 0.012 * Math.sin(a * 23 + f * 0.09));
  const CX = 486;
  const CY = 420;
  const buildFront = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r = front(a);
      const X = CX + Math.cos(a) * r;
      const Y = CY + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  };

  if (flooded) {
    if (!flood) flood = offscreen(FS, FS);
    const fc = flood.c;
    fc.globalCompositeOperation = "source-over";
    fc.clearRect(0, 0, FS, FS);
    const deep = interpolate(s.level, [0, 1], [0.6, 1]);
    const g = fc.createRadialGradient(CX, CY, 20, CX, CY, Math.max(120, R));
    g.addColorStop(0, `rgba(190,120,44,${deep})`);
    g.addColorStop(0.7, `rgba(170,98,30,${deep})`);
    g.addColorStop(1, `rgba(214,152,74,${deep})`);
    fc.fillStyle = g;
    fc.fillRect(0, 0, FS, FS);

    // Milk clouds and out-of-focus deep globules give the liquid depth
    if (!swirl) swirl = buildSwirl();
    fc.drawImage(swirl.el, -260 - pan.x * 0.6, -260 - pan.y * 0.6);

    // Slow Brownian specimens, all in stage space so the slide drifts under them
    for (let i = 0; i < 150; i++) {
      const x = (hash(i, 61) * 1500 - pan.x * 1.2 + Math.sin(f * 0.11 + i) * 5 + 1500) % 1500 - 260;
      const y = (hash(i, 62) * 1500 - pan.y * 1.2 + Math.cos(f * 0.09 + i * 1.7) * 5 + 1500) % 1500 - 260;
      fragment(fc, x, y, 7 + hash(i, 63) * 15, f * 0.004 * (hash(i, 64) - 0.5) + i, i);
    }
    for (let i = 0; i < 280; i++) {
      const x = (hash(i, 71) * 1500 - pan.x + Math.sin(f * 0.13 + i * 2) * 7 + 1500) % 1500 - 260;
      const y = (hash(i, 72) * 1500 - pan.y + Math.cos(f * 0.1 + i) * 7 + 1500) % 1500 - 260;
      const r = 5 + Math.pow(hash(i, 73), 2.6) * 46;
      globule(fc, x, y, r, hash(i, 74));
    }
    for (let i = 0; i < 16; i++) {
      const x = (hash(i, 81) * 1500 - pan.x * 0.8 + 1500) % 1500 - 260;
      const y = (hash(i, 82) * 1500 - pan.y * 0.8 + 1500) % 1500 - 260;
      fc.strokeStyle = "rgba(40,20,8,0.5)";
      fc.lineWidth = 3;
      fc.beginPath();
      fc.ellipse(x, y, 34, 17, hash(i, 83) * 3, 0, Math.PI * 2);
      fc.stroke();
      fc.strokeStyle = "rgba(255,232,190,0.4)";
      fc.lineWidth = 1.5;
      fc.beginPath();
      fc.ellipse(x, y, 28, 11, hash(i, 83) * 3, 0, Math.PI * 2);
      fc.stroke();
    }

    fc.globalCompositeOperation = "destination-in";
    buildFront(fc);
    fc.fillStyle = "#000";
    fc.fill();
    fc.globalCompositeOperation = "source-over";
    c.drawImage(flood.el, 0, 0);

    // Meniscus at the edge of the flood
    buildFront(c);
    c.lineWidth = 14;
    c.strokeStyle = "rgba(92,50,16,0.65)";
    c.stroke();
    buildFront(c);
    c.lineWidth = 3;
    c.strokeStyle = "rgba(255,240,200,0.95)";
    c.stroke();
  }

  // Ripples and droplets
  for (let j = 0; j < 19; j++) {
    const d = dropRec(j);
    const age = f - d.land;
    if (age >= 0 && age < 24) {
      for (let k = 0; k < 2; k++) {
        const ra = d.r + (age - k * 4) * 11;
        if (ra <= d.r) continue;
        c.strokeStyle = `rgba(255,236,190,${(1 - age / 24) * 0.5})`;
        c.lineWidth = 4;
        c.beginPath();
        c.arc(d.x1, d.y1, ra, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = `rgba(66,34,10,${(1 - age / 24) * 0.42})`;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(d.x1, d.y1, ra + 7, 0, Math.PI * 2);
        c.stroke();
      }
    }
    if (f >= d.spawn && f < d.land) {
      const t = (f - d.spawn) / (d.land - d.spawn);
      const eased = t * t;
      const x = d.x0 + (d.x1 - d.x0) * eased;
      const y = -70 + (d.y1 + 70) * eased;
      const r = d.r * (2 - t);
      const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
      g.addColorStop(0, "rgba(255,250,230,0.95)");
      g.addColorStop(0.45, "rgba(226,160,74,0.74)");
      g.addColorStop(0.85, "rgba(96,50,14,0.86)");
      g.addColorStop(1, "rgba(96,50,14,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Steam: condensate beads climbing, soft and slightly above the focal plane
  const vapor = interpolate(f, [104, 140], [0, 0.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (vapor > 0) {
    c.fillStyle = `rgba(255,250,236,${vapor})`;
    c.fillRect(0, 0, FS, FS);
    c.filter = "blur(5px)";
    s.steam.forEach((p, i) => {
      if (p <= 0) return;
      pathPts(steamPath(i, p, f * 0.05)).forEach((pt, k) => {
        if (k % 3) return;
        const X = 486 + (pt.x - 540) * 3.1 + Math.sin(k * 2.3 + i) * 16;
        const Y = FS + 40 - (770 - pt.y) * 2.8;
        const r = 18 + hash(i, k, 7) * 30;
        const g = c.createRadialGradient(X - r * 0.3, Y - r * 0.3, 1, X, Y, r);
        g.addColorStop(0, "rgba(255,255,255,0.72)");
        g.addColorStop(0.7, "rgba(236,246,255,0.3)");
        g.addColorStop(1, "rgba(120,140,170,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(X, Y, r, 0, Math.PI * 2);
        c.fill();
      });
    });
    c.filter = "none";
  }

  // The kettle overhead is only a blurred shadow crossing the slide
  if (s.kx < 1340) {
    const sx = 486 + (s.kx - 796) * 1.25 + 170;
    const g = c.createRadialGradient(sx, 120, 40, sx, 120, 460);
    const k = 0.62;
    g.addColorStop(0, `rgba(22,12,8,${k})`);
    g.addColorStop(1, "rgba(22,12,8,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, FS, FS);
  }
};

export const Microscope: React.FC = () => {
  const f = useCurrentFrame();
  const draw = (c: CanvasRenderingContext2D) => {
    if (!field) {
      field = offscreen(FS, FS);
    }
    const fl = field;
    paintField(fl.c, f);

    // Eyepiece body
    c.fillStyle = "#050507";
    c.fillRect(0, 0, 1080, 1350);
    const back = c.createRadialGradient(LX, LY, LR, LX, LY, 780);
    back.addColorStop(0, "#1c1d22");
    back.addColorStop(1, "#050507");
    c.fillStyle = back;
    c.fillRect(0, 0, 1080, 1350);
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2 + f * 0.0015;
      c.strokeStyle = i % 2 ? "#32343c" : "#101116";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(LX + Math.cos(a) * (LR + 22), LY + Math.sin(a) * (LR + 22));
      c.lineTo(LX + Math.cos(a) * (LR + 44), LY + Math.sin(a) * (LR + 44));
      c.stroke();
    }

    // Focus: racks in at the start, breathes as the pour ends
    const focus =
      interpolate(f, [0, 16], [9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) +
      interpolate(f, [96, 104, 116], [0, 2.6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    c.save();
    c.beginPath();
    c.arc(LX, LY, LR, 0, Math.PI * 2);
    c.clip();
    if (focus > 0.05) c.filter = `blur(${focus.toFixed(2)}px)`;
    c.drawImage(fl.el, LX - FS / 2, LY - FS / 2);
    c.filter = "none";

    // Graticule, a ruler with no numbers
    c.strokeStyle = "rgba(24,16,10,0.72)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(LX - 370, LY);
    c.lineTo(LX + 370, LY);
    c.moveTo(LX, LY - 370);
    c.lineTo(LX, LY + 370);
    c.stroke();
    for (let i = -37; i <= 37; i++) {
      const h = i % 10 === 0 ? 26 : i % 5 === 0 ? 17 : 9;
      c.beginPath();
      c.moveTo(LX + i * 10, LY - h);
      c.lineTo(LX + i * 10, LY + h);
      c.stroke();
    }
    // Field stop, lens falloff and colour fringing
    const vg = c.createRadialGradient(LX, LY, LR * 0.62, LX, LY, LR);
    vg.addColorStop(0, "rgba(10,6,4,0)");
    vg.addColorStop(0.82, "rgba(10,6,4,0.32)");
    vg.addColorStop(1, "rgba(10,6,4,0.96)");
    c.fillStyle = vg;
    c.fillRect(0, 0, 1080, 1350);
    c.restore();

    c.lineWidth = 3;
    c.strokeStyle = "rgba(255,80,60,0.5)";
    c.beginPath();
    c.arc(LX, LY, LR - 3, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgba(70,150,255,0.5)";
    c.beginPath();
    c.arc(LX, LY, LR + 1, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "#3f4048";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(LX, LY, LR + 11, 0, Math.PI * 2);
    c.stroke();
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#050507" }}>
      <Cv w={1080} h={1350} draw={draw} />
    </div>
  );
};
