import React from 'react';
import { noise2D } from '@remotion/noise';
import { makeStar, makePolygon } from '@remotion/shapes';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha } from './themes';
import { useStudio } from './layout';

/**
 * The clip's living backdrop, drawn once under every scene so transitions move only the
 * foreground: a base gradient, colour fields drifting on simplex noise (a soft gradient mesh),
 * the theme's texture (grid, paper or neon lines), floating accent shapes and a periodic
 * light sweep.
 */
export const Background: React.FC<{ seed: string }> = ({ seed }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const { theme, u } = useStudio();
  const t = frame / 30;

  const blobs = theme.blobs.map((color, i) => {
    const x = 50 + noise2D(`${seed}-x${i}`, t * 0.05, i) * 38;
    const y = 50 + noise2D(`${seed}-y${i}`, i, t * 0.05) * 40;
    const r = 55 + noise2D(`${seed}-r${i}`, t * 0.04, i * 3) * 12;
    return `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent ${r}%)`;
  });

  const sweepPeriod = 7 * 30;
  const sweep = interpolate(frame % sweepPeriod, [0, 70], [-0.6, 1.6], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(165deg, ${theme.base[0]}, ${theme.base[1]})` }}>
      <AbsoluteFill style={{ background: blobs.join(',') }} />
      <Texture />
      <Shapes seed={seed} />
      <AbsoluteFill
        style={{
          background: `linear-gradient(115deg, transparent ${sweep * 100 - 18}%, ${
            theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.45)'
          } ${sweep * 100}%, transparent ${sweep * 100 + 18}%)`,
        }}
      />
      {/* Vignette keeps the edges calm so text stays readable on every theme. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 45%, transparent 55%, ${
            theme.dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.08)'
          } 100%)`,
        }}
      />
      <ProgressBar frame={frame} total={durationInFrames} width={width} height={height} u={u} />
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{ frame: number; total: number; width: number; height: number; u: number }> = ({
  frame,
  total,
  width,
  u,
}) => {
  const { theme, rtl } = useStudio();
  const p = Math.min(1, frame / Math.max(1, total - 1));
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        [rtl ? 'right' : 'left']: 0,
        height: Math.max(3, u * 0.5),
        width: width * p,
        background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
        opacity: 0.85,
      }}
    />
  );
};

const Texture: React.FC = () => {
  const frame = useCurrentFrame();
  const { theme, u } = useStudio();
  if (theme.background === 'grid') {
    const size = u * 8;
    return (
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${alpha(theme.text, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(
            theme.text,
            0.05,
          )} 1px, transparent 1px)`,
          backgroundSize: `${size}px ${size}px`,
          backgroundPosition: `${(frame * 0.3) % size}px ${(frame * 0.2) % size}px`,
        }}
      />
    );
  }
  if (theme.background === 'neon') {
    const size = u * 10;
    return (
      <AbsoluteFill style={{ perspective: u * 60, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: '-50%',
            right: '-50%',
            top: '55%',
            height: '90%',
            transform: 'rotateX(70deg)',
            transformOrigin: 'top',
            backgroundImage: `linear-gradient(${alpha(theme.accent, 0.35)} 2px, transparent 2px), linear-gradient(90deg, ${alpha(
              theme.accent2,
              0.3,
            )} 2px, transparent 2px)`,
            backgroundSize: `${size}px ${size}px`,
            backgroundPosition: `0 ${(frame * 1.2) % size}px`,
          }}
        />
      </AbsoluteFill>
    );
  }
  if (theme.background === 'paper') {
    return (
      <AbsoluteFill
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, ${alpha(theme.text, 0.035)} 0 1px, transparent 1px ${u * 3}px)`,
        }}
      />
    );
  }
  return null;
};

const Shapes: React.FC<{ seed: string }> = ({ seed }) => {
  const frame = useCurrentFrame();
  const { theme, u, width, height } = useStudio();
  const t = frame / 30;
  const items = [0, 1, 2, 3, 4];
  return (
    <AbsoluteFill>
      {items.map((i) => {
        const x = (0.15 + ((i * 0.37) % 0.8)) * width + noise2D(`${seed}-sx${i}`, t * 0.08, i) * u * 6;
        const y = (0.1 + ((i * 0.53) % 0.85)) * height + noise2D(`${seed}-sy${i}`, i, t * 0.08) * u * 6;
        const size = u * (6 + (i % 3) * 5);
        const rot = t * (i % 2 ? 8 : -6) + i * 30;
        const color = i % 2 ? theme.accent2 : theme.accent;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              transform: `rotate(${rot}deg)`,
              opacity: theme.dark ? 0.14 : 0.12,
            }}
          >
            <Shape kind={theme.shape} size={size} color={color} index={i} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Shape: React.FC<{ kind: string; size: number; color: string; index: number }> = ({ kind, size, color, index }) => {
  if (kind === 'rings' || kind === 'dots') {
    return kind === 'rings' ? (
      <div style={{ width: size, height: size, borderRadius: '50%', border: `${Math.max(2, size * 0.06)}px solid ${color}` }} />
    ) : (
      <div style={{ width: size * 0.4, height: size * 0.4, borderRadius: '50%', background: color }} />
    );
  }
  const shape =
    kind === 'stars'
      ? makeStar({ points: 4 + (index % 2), innerRadius: size * 0.18, outerRadius: size * 0.48, edgeRoundness: 0.4 })
      : makePolygon({ points: 3 + (index % 3), radius: size * 0.45, edgeRoundness: 0.2 });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${shape.width} ${shape.height}`}>
      <path d={shape.path} fill="none" stroke={color} strokeWidth={Math.max(2, size * 0.05)} />
    </svg>
  );
};
