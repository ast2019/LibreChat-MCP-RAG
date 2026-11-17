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

  if (kind === 'woodblock') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(139,30,30,0.06) 0 3px, transparent 3px 14px)',
          }}
        />
        <svg width={width} height={height}>
          <path
            d={`M ${width * 0.7} ${height * 0.12} Q ${width * 0.85} ${height * 0.28} ${width * 0.62} ${height * 0.4}`}
            fill="none"
            stroke="#8b1e1e"
            strokeWidth="8"
            opacity={0.35}
          />
          <circle
            cx={width * 0.78}
            cy={height * 0.18}
            r={36}
            fill="none"
            stroke="#8b1e1e"
            strokeWidth="5"
            opacity={0.4}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'noir') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 8px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '6%',
            top: '10%',
            width: 120,
            height: 160,
            border: '4px solid #fff',
            opacity: 0.35,
            transform: `skewY(${Math.sin(t) * 2}deg)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'cartoon30s') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <circle cx={width * 0.82} cy={height * 0.16} r={40} fill="none" stroke="#222" strokeWidth="3" strokeDasharray="2 4" />
          <StickFigure x={width * 0.78} y={height * 0.28} scale={0.9} stroke="#222" swing={Math.sin(t * 4) * 3} />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)',
            backgroundSize: '4px 4px',
            opacity: 0.4,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'clay') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '22%',
            background: 'linear-gradient(180deg, transparent, rgba(90,140,90,0.45))',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '10%',
            right: '8%',
            width: 70,
            height: 70,
            borderRadius: '50%',
            background: '#f4d35e',
            boxShadow: 'inset -8px -6px 0 rgba(0,0,0,0.12)',
            transform: `translateY(${Math.sin(t) * 4}px)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'crt') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)',
            opacity: 0.7,
          }}
        />
        <svg width={width} height={height}>
          <polyline
            points={`${40},${height * 0.7} ${width * 0.25},${height * 0.55} ${width * 0.45},${height * 0.65} ${width * 0.7},${height * 0.4} ${width - 40},${height * 0.5}`}
            fill="none"
            stroke="#33ff66"
            strokeWidth="2"
            opacity={0.55}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'knit') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(201,123,99,0.12) 0 6px, transparent 6px 12px), repeating-linear-gradient(-45deg, rgba(201,123,99,0.12) 0 6px, transparent 6px 12px)',
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'sumi') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <path
            d={`M ${width * 0.15} ${height * 0.75} Q ${width * 0.4} ${height * 0.55} ${width * 0.55} ${height * 0.7} T ${width * 0.9} ${height * 0.6}`}
            fill="none"
            stroke="#111"
            strokeWidth="3"
            opacity={0.35}
          />
          <circle cx={width * 0.78} cy={height * 0.18} r={28} fill="none" stroke="#111" strokeWidth="2" opacity={0.45} />
          <ellipse cx={width * 0.72} cy={height * 0.32} rx={50} ry={18} fill="#111" opacity={0.08} />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'iso') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <polygon
            points={`${width * 0.72},${height * 0.2} ${width * 0.88},${height * 0.28} ${width * 0.72},${height * 0.36} ${width * 0.56},${height * 0.28}`}
            fill="#ee6c4d"
            opacity={0.85}
          />
          <polygon
            points={`${width * 0.72},${height * 0.36} ${width * 0.88},${height * 0.28} ${width * 0.88},${height * 0.42} ${width * 0.72},${height * 0.5}`}
            fill="#3d5a80"
            opacity={0.7}
          />
          <polygon
            points={`${width * 0.72},${height * 0.36} ${width * 0.72},${height * 0.5} ${width * 0.56},${height * 0.42} ${width * 0.56},${height * 0.28}`}
            fill="#1b2a41"
            opacity={0.55}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'papercut') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              right: `${6 + i * 4}%`,
              top: `${12 + i * 8}%`,
              width: 90 - i * 12,
              height: 70 - i * 8,
              backgroundColor: i === 0 ? '#c45c26' : i === 1 ? '#e9c46a' : '#2a9d8f',
              borderRadius: 8,
              boxShadow: '6px 8px 0 rgba(0,0,0,0.12)',
              transform: `rotate(${-8 + i * 6 + Math.sin(t + i) * 2}deg)`,
            }}
          />
        ))}
      </AbsoluteFill>
    );
  }

  if (kind === 'chart') {
    const bars = [0.35, 0.55, 0.4, 0.75, 0.5];
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          {bars.map((h, i) => {
            const bh = h * height * 0.28 * (0.85 + 0.15 * Math.sin(t * 2 + i));
            const x = width * 0.55 + i * 28;
            const y = height * 0.78 - bh;
            return <rect key={i} x={x} y={y} width={18} height={bh} fill="#38bdf8" opacity={0.7} rx={2} />;
          })}
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'synthwave') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '14%',
            width: 140,
            height: 140,
            marginLeft: -70,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #ff9f1c 0%, #ff2bd6 55%, transparent 70%)',
            opacity: 0.85,
          }}
        />
        <svg width={width} height={height}>
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={i}
              x1={0}
              y1={height * 0.55 + i * 18}
              x2={width}
              y2={height * 0.55 + i * 18 + (i - 4) * 4}
              stroke="#ff2bd6"
              strokeWidth="1"
              opacity={0.25 + i * 0.04}
            />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={(width / 9) * i}
              y1={height * 0.55}
              x2={width / 2 + (i - 4.5) * width * 0.12}
              y2={height}
              stroke="#7b2cbf"
              strokeWidth="1"
              opacity={0.3}
            />
          ))}
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'explainer3d') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            right: '8%',
            top: '16%',
            width: 100,
            height: 100,
            background: '#2563eb',
            borderRadius: 16,
            boxShadow: '12px 14px 0 rgba(30,41,59,0.2)',
            transform: `rotateX(12deg) rotateY(${-18 + Math.sin(t) * 4}deg)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'maths') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <line x1={40} y1={height * 0.7} x2={width - 40} y2={height * 0.7} stroke="#94a3b8" strokeWidth="1" />
          <line x1={60} y1={height * 0.35} x2={60} y2={height * 0.78} stroke="#94a3b8" strokeWidth="1" />
          <path
            d={`M 60 ${height * 0.65} Q ${width * 0.35} ${height * 0.35} ${width * 0.75} ${height * 0.55}`}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="2.5"
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'cartoonExp') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <StickFigure x={width * 0.8} y={height * 0.26} scale={1.1} stroke="#1c1917" swing={Math.sin(t * 3) * 4} />
          <ellipse cx={width * 0.8} cy={height * 0.12} rx={48} ry={22} fill="#fff" stroke="#1c1917" strokeWidth="3" />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'domino') {
    const tiles = [0, 1, 2, 3, 4];
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {tiles.map((i) => {
          const tip = Math.max(0, Math.min(1, (t * 1.2 - i * 0.18)));
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${18 + i * 12}%`,
                bottom: '12%',
                width: 28,
                height: 70,
                backgroundColor: '#fbbf24',
                borderRadius: 4,
                transformOrigin: 'bottom center',
                transform: `rotate(${tip * 55}deg)`,
                opacity: 0.85,
              }}
            />
          );
        })}
      </AbsoluteFill>
    );
  }

  if (kind === 'atom') {
    const rot = (frame / fps) * 50;
    const cx = width * 0.72;
    const cy = height * 0.28;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <circle cx={cx} cy={cy} r={10} fill="#38bdf8" />
          {[0, 60, 120].map((a) => (
            <ellipse
              key={a}
              cx={cx}
              cy={cy}
              rx={70}
              ry={28}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              opacity={0.7}
              transform={`rotate(${a + rot} ${cx} ${cy})`}
            />
          ))}
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'blueprint') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(125,211,252,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.12) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <svg width={width} height={height}>
          <rect
            x={width * 0.58}
            y={height * 0.16}
            width={width * 0.28}
            height={height * 0.22}
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind === 'mosaic') {
    const colors = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#14b8a6'];
    const tiles = [];
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 4; x++) {
        tiles.push(
          <div
            key={`${x}-${y}`}
            style={{
              position: 'absolute',
              right: 16 + x * 26,
              top: 24 + y * 26,
              width: 22,
              height: 22,
              backgroundColor: colors[(x + y) % colors.length],
              opacity: 0.85,
            }}
          />,
        );
      }
    }
    return <AbsoluteFill style={{ pointerEvents: 'none' }}>{tiles}</AbsoluteFill>;
  }

  if (kind === 'watercolor') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(147,197,253,0.45), transparent 70%)',
            left: '8%',
            top: '12%',
            filter: 'blur(4px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 160,
            height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(252,165,165,0.4), transparent 70%)',
            right: '6%',
            bottom: '18%',
            filter: 'blur(5px)',
          }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'threejs') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <svg width={width} height={height}>
          <polygon
            points={`${width * 0.7},${height * 0.18} ${width * 0.88},${height * 0.32} ${width * 0.62},${height * 0.42}`}
            fill="none"
            stroke="#818cf8"
            strokeWidth="2"
            opacity={0.85}
          />
          <circle cx={width * 0.74} cy={height * 0.3} r={6} fill="#818cf8" />
          <line
            x1={width * 0.7}
            y1={height * 0.18}
            x2={width * 0.74}
            y2={height * 0.3}
            stroke="#818cf8"
            strokeWidth="1.5"
            opacity={0.7}
          />
        </svg>
      </AbsoluteFill>
    );
  }

  if (kind !== 'orbit') {
    return null;
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
