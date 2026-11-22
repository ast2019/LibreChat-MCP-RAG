import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { CSSProperties } from 'react';
import { useStudio } from '../layout';

/** The safe-area content box every scene lays out in, with the clip's text direction. */
export const SceneFrame: React.FC<{
  children: React.ReactNode;
  justify?: CSSProperties['justifyContent'];
  gap?: number;
  style?: CSSProperties;
}> = ({ children, justify = 'center', gap, style }) => {
  const { safe, rtl, u } = useStudio();
  return (
    <AbsoluteFill
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        paddingTop: safe.top,
        paddingBottom: safe.bottom,
        paddingInlineStart: safe.start,
        paddingInlineEnd: safe.end,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        gap: gap ?? u * 3,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** A gentle push-in over the whole scene so nothing is ever fully static. */
export const Drift: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, frames], [1, 1.04], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};

export interface SceneProps<T> {
  scene: T;
  /** Frames the scene is on screen (without its outgoing transition) */
  frames: number;
}
