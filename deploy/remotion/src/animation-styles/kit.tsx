import React from "react";
import { AbsoluteFill } from "remotion";
import { H, W } from "./story";

export const Stage: React.FC<{ bg: string; children: React.ReactNode; defs?: React.ReactNode }> = ({ bg, children, defs }) => (
  <AbsoluteFill style={{ background: bg }}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      {defs ? <defs>{defs}</defs> : null}
      {children}
    </svg>
  </AbsoluteFill>
);

export const region = { filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H } as const;

export const Paper: React.FC<{ id: string; opacity: number; freq?: number }> = ({ id, opacity, freq = 0.8 }) => (
  <>
    <filter id={id} {...region}>
      <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={3} seed={7} />
      <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0.9 -0.32" />
    </filter>
    <rect id={`${id}-r`} width={W} height={H} filter={`url(#${id})`} opacity={opacity} />
  </>
);

export const Rough: React.FC<{ id: string; seed: number; freq: number; scale: number; shadow?: boolean }> = ({
  id, seed, freq, scale, shadow,
}) => (
  <filter id={id} {...region}>
    <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={2} seed={seed} result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} xChannelSelector="R" yChannelSelector="G" result="d" />
    {shadow ? <feDropShadow in="d" dx={5} dy={9} stdDeviation={5} floodColor="#2a1a0c" floodOpacity={0.42} /> : null}
  </filter>
);
