import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Loop,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { DUR, FPS, H, W } from './animation-styles/story';
import { resolveStyleComponent } from './themeMap';
import type { ClipScene } from './Composition';

export interface StyledFilmProps {
  theme: string;
  title: string;
  brandName: string;
  brandColor: string;
  scenes: ClipScene[];
  audioSrc?: string;
  /** Output length in seconds; the style loops (native loop is DUR frames). */
  durationSec?: number;
}

const CaptionOverlay: React.FC<{
  scenes: ClipScene[];
  brandName: string;
  brandColor: string;
  title: string;
}> = ({ scenes, brandName, brandColor, title }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const lines = scenes
    .flatMap((scene) => [scene.heading, scene.body, ...(scene.bullets ?? [])])
    .filter((x): x is string => Boolean(x))
    .slice(0, 6);
  // inputRange must be strictly increasing, also for very short compositions.
  const last = Math.max(3, durationInFrames - 1);
  const fadeIn = Math.max(1, Math.min(12, Math.floor(last * 0.1)));
  const fadeOut = Math.min(
    last - 1,
    Math.max(fadeIn + 1, last - Math.min(18, Math.floor(last * 0.12))),
  );
  const fade = interpolate(frame, [0, fadeIn, fadeOut, last], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const active =
    lines[
      Math.min(
        Math.max(0, lines.length - 1),
        Math.floor((frame / Math.max(1, durationInFrames)) * Math.max(1, lines.length)),
      )
    ] ?? title;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '6%',
          right: '6%',
          top: '4%',
          opacity: fade,
          color: '#fff',
          fontFamily: '"Vazirmatn", "Segoe UI", sans-serif',
          textShadow: '0 2px 12px rgba(0,0,0,0.75)',
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700, color: brandColor || '#2ea884' }}>{brandName}</div>
        <div style={{ fontSize: 22, marginTop: 6, opacity: 0.9 }}>{title}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '5%',
          right: '5%',
          bottom: '6%',
          opacity: fade,
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 18,
          padding: '18px 22px',
          color: '#fff',
          fontFamily: '"Vazirmatn", "Segoe UI", sans-serif',
          fontSize: 34,
          lineHeight: 1.35,
          textAlign: 'center',
          direction: /[\u0600-\u06FF]/.test(active) ? 'rtl' : 'ltr',
        }}
      >
        {active}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Full style film (vendored animation-styles catalog) with caption/brand overlay.
 * Native size is 1080×1350 @ 30fps, one 5s loop that repeats for the requested length.
 */
export const HiveGPTStyledFilm: React.FC<StyledFilmProps> = ({
  theme,
  title,
  brandName,
  brandColor,
  scenes,
  audioSrc,
}) => {
  const Style = resolveStyleComponent(theme);
  if (!Style) {
    return (
      <AbsoluteFill style={{ background: '#111', color: '#fff', padding: 40 }}>
        Missing style for theme {theme}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      {audioSrc ? <Audio src={audioSrc} /> : null}
      <Loop durationInFrames={DUR}>
        <Style />
      </Loop>
      <CaptionOverlay
        scenes={scenes}
        brandName={brandName}
        brandColor={brandColor}
        title={title}
      />
    </AbsoluteFill>
  );
};

export const STYLED_FILM_META = { width: W, height: H, fps: FPS, durationInFrames: DUR };
