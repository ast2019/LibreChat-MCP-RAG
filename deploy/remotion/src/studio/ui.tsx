import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CSSProperties } from 'react';
import { alpha } from './themes';
import { useStudio } from './layout';

/** Spring from 0 to 1 starting at `delay` frames into the scene. */
export function useEnter(delay = 0, config: { damping?: number; mass?: number; stiffness?: number } = {}): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 16, mass: 0.7, ...config } });
}

/** Tabler outline icon drawn from the nodes the worker resolved (24×24 grid, 2px stroke). */
export const Icon: React.FC<{ name?: string; size: number; color?: string; stroke?: number; style?: CSSProperties }> = ({
  name,
  size,
  color,
  stroke = 2,
  style,
}) => {
  const { icons, theme } = useStudio();
  const nodes = (name && icons[name]) || icons.sparkles || [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.accent}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
};

/** Icon on a rounded accent tile that pops in. */
export const IconTile: React.FC<{ name?: string; size: number; delay?: number; color?: string; solid?: boolean }> = ({
  name,
  size,
  delay = 0,
  color,
  solid = false,
}) => {
  const { theme } = useStudio();
  const p = useEnter(delay, { damping: 12 });
  const tint = color ?? theme.accent;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: solid ? tint : `linear-gradient(145deg, ${alpha(tint, 0.28)}, ${alpha(tint, 0.1)})`,
        border: `1px solid ${alpha(tint, 0.45)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transform: `scale(${p}) rotate(${(1 - p) * -12}deg)`,
        boxShadow: `0 ${size * 0.12}px ${size * 0.4}px ${alpha(tint, 0.25)}`,
      }}
    >
      <Icon name={name} size={size * 0.56} color={solid ? theme.onAccent : tint} />
    </div>
  );
};

/** Frosted card surface. */
export const Card: React.FC<{ children: React.ReactNode; style?: CSSProperties; pad?: number }> = ({
  children,
  style,
  pad,
}) => {
  const { theme, u } = useStudio();
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: u * 3.2,
        padding: pad ?? u * 3,
        boxShadow: theme.dark ? `0 ${u}px ${u * 4}px rgba(0,0,0,0.35)` : `0 ${u}px ${u * 4}px rgba(15,23,42,0.10)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Small uppercase label in a pill. */
export const Pill: React.FC<{ children: React.ReactNode; delay?: number; color?: string }> = ({
  children,
  delay = 0,
  color,
}) => {
  const { theme, u, fonts } = useStudio();
  const p = useEnter(delay);
  const tint = color ?? theme.accent;
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: u,
        padding: `${u * 0.9}px ${u * 2.2}px`,
        borderRadius: 999,
        background: alpha(tint, 0.16),
        border: `1px solid ${alpha(tint, 0.5)}`,
        color: tint,
        fontFamily: fonts.body,
        fontWeight: 700,
        fontSize: u * 3,
        letterSpacing: '0.04em',
        opacity: p,
        transform: `translateY(${(1 - p) * u * 3}px)`,
      }}
    >
      {children}
    </div>
  );
};
