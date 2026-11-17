import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DecorKind } from './themes';

const StickFigure: React.FC<{
  x: number;
  y: number;
  scale?: number;
  stroke?: string;
  swing?: number;
}> = ({ x, y, scale = 1, stroke = '#fff', swing = 0 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <circle cx="0" cy="-42" r="10" fill="none" stroke={stroke} strokeWidth="2.5" />
    <line x1="0" y1="-32" x2="0" y2="8" stroke={stroke} strokeWidth="2.5" />
    <line
      x1="0"
      y1="-18"
      x2={-18 + swing}
      y2="4"
      stroke={stroke}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <line
      x1="0"
      y1="-18"
      x2={18 - swing}
      y2="4"
      stroke={stroke}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <line
      x1="0"
      y1="8"
      x2={-12 - swing * 0.4}
      y2="40"
      stroke={stroke}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <line
      x1="0"
      y1="8"
      x2={12 + swing * 0.4}
      y2="40"
      stroke={stroke}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </g>
);

export const ThemeDecor: React.FC<{ kind: DecorKind; accent: string }> = ({ kind, accent }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;

  if (kind === 'none') {
    return null;
  }

  if (kind === 'halftone') {
    const dots = [];
    for (let y = 20; y < height; y += 28) {
      for (let x = 20; x < width; x += 28) {
        dots.push(
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={2.2}
            fill="rgba(0,0,0,0.12)"
          />,
        );
      }
    }
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          {dots}
        </svg>
        <div
          style={{
            position: 'absolute',
            top: '8%',
            right: '6%',
            width: 90,
            height: 90,
            borderRadius: '50%',
            border: `5px solid ${accent}`,
            transform: `rotate(${frame * 1.5}deg)`,
            opacity: 0.85,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'orbs') {
    const a = interpolate(frame, [0, durationInFrames], [0, 1]);
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(110,200,255,0.55), transparent 70%)',
            left: `${18 + Math.sin(t) * 8}%`,
            top: `${12 + Math.cos(t * 0.8) * 6}%`,
            filter: 'blur(2px)',
            opacity: 0.7 + a * 0.2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 160,
            height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(180,80,255,0.5), transparent 70%)',
            right: `${10 + Math.cos(t * 1.2) * 6}%`,
            bottom: `${18 + Math.sin(t * 0.9) * 5}%`,
            filter: 'blur(1px)',
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'bricks') {
    const studs = [];
    for (let i = 0; i < 8; i++) {
      studs.push(
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 18 + (i % 2) * 18,
            left: 16 + i * 46,
            width: 28,
            height: 18,
            borderRadius: 6,
            backgroundColor: i % 3 === 0 ? '#d62828' : i % 3 === 1 ? '#0077b6' : '#2a9d8f',
            border: '2px solid rgba(0,0,0,0.25)',
            boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.35)',
          }}
        />,
      );
    }
    return <AbsoluteFill style={{ pointerEvents: 'none' }}>{studs}</AbsoluteFill>;
  }

  if (kind === 'chalk') {
    const dust = Array.from({ length: 18 }, (_, i) => {
      const x = (i * 53) % width;
      const y = (i * 97 + frame * 0.4) % height;
      return (
        <circle key={i} cx={x} cy={y} r={1.2 + (i % 3) * 0.4} fill="rgba(245,240,225,0.25)" />
      );
    });
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          {dust}
          <rect
            x={18}
            y={18}
            width={width - 36}
            height={height - 36}
            fill="none"
            stroke="rgba(245,240,225,0.28)"
            strokeWidth="3"
            strokeDasharray="10 8"
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'pixels') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 12,
            border: `4px solid ${accent}`,
            boxShadow: `0 0 0 4px #1a1c2c, 0 0 0 8px ${accent}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 24,
            bottom: 56,
            width: 48,
            height: 48,
            backgroundImage: `linear-gradient(90deg, ${accent} 50%, transparent 50%), linear-gradient(${accent} 50%, transparent 50%)`,
            backgroundSize: '12px 12px',
            opacity: 0.85,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'shapes') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            top: '12%',
            right: '8%',
            width: 110,
            height: 110,
            borderRadius: 28,
            backgroundColor: accent,
            opacity: 0.9,
            transform: `rotate(${-12 + Math.sin(t) * 4}deg)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '16%',
            left: '6%',
            width: 90,
            height: 90,
            borderRadius: '50%',
            backgroundColor: '#a8dadc',
            opacity: 0.85,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'doodle') {
    const swing = Math.sin(t * 3) * 4;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <StickFigure x={width * 0.78} y={height * 0.22} scale={1.1} stroke="#111" swing={swing} />
          <path
            d={`M ${width * 0.1} ${height * 0.82} Q ${width * 0.35} ${height * 0.74 + swing} ${width * 0.55} ${height * 0.84}`}
            fill="none"
            stroke="#111"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={width * 0.18} cy={height * 0.18} r={18} fill="none" stroke="#111" strokeWidth="3" />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'neon') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <rect
            x={22}
            y={22}
            width={width - 44}
            height={height - 44}
            fill="none"
            stroke={accent}
            strokeWidth="2"
            style={{ filter: `drop-shadow(0 0 8px ${accent})` }}
          />
          <path
            d={`M 40 ${height * 0.75} C ${width * 0.3} ${height * 0.65 + Math.sin(t) * 10}, ${width * 0.6} ${height * 0.85}, ${width - 40} ${height * 0.7}`}
            fill="none"
            stroke={accent}
            strokeWidth="2.5"
            opacity={0.7}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'scanlines') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)',
            mixBlendMode: 'multiply',
            opacity: 0.55,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(90deg, transparent, rgba(102,192,244,${0.05 + (Math.sin(t * 2) + 1) * 0.03}), transparent)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // dan-koe orbit stick figure
  const cx = width * 0.5;
  const cy = height * 0.38;
  const rot = (frame / fps) * 40;
  const swing = Math.sin(t * 2.2) * 5;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width={width} height={height}>
        {[70, 110, 150].map((r, i) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth="1.2"
            strokeDasharray={i === 1 ? '4 8' : undefined}
            opacity={0.55 - i * 0.1}
            transform={`rotate(${rot * (i % 2 === 0 ? 1 : -1)} ${cx} ${cy})`}
          />
        ))}
        <circle
          cx={cx + Math.cos((rot * Math.PI) / 180) * 110}
          cy={cy + Math.sin((rot * Math.PI) / 180) * 110}
          r={4}
          fill="#fff"
        />
        <StickFigure x={cx} y={cy + 8} scale={1.35} stroke="#fff" swing={swing} />
      </svg>
    </AbsoluteFill>
  );
};
