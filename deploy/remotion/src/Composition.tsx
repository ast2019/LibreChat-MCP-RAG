import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type SceneType = 'title' | 'bullets' | 'closing';
export type ClipTheme = 'brand-dark' | 'brand-light' | 'ugc';

export interface ClipScene {
  type: SceneType;
  durationSec: number;
  heading?: string;
  body?: string;
  bullets?: string[];
}

export interface ClipProps {
  title: string;
  theme: ClipTheme;
  brandName: string;
  brandColor: string;
  scenes: ClipScene[];
  /** file:// or data URL for narration/music */
  audioSrc?: string;
}

const THEMES: Record<
  ClipTheme,
  { bg: string; fg: string; muted: string; gradient: string }
> = {
  'brand-dark': {
    bg: '#0b1412',
    fg: '#f4f7f5',
    muted: 'rgba(244,247,245,0.78)',
    gradient: 'radial-gradient(ellipse at 50% 18%, rgba(46, 168, 132, 0.45) 0%, transparent 55%)',
  },
  'brand-light': {
    bg: '#f7faf8',
    fg: '#0b1412',
    muted: 'rgba(11,20,18,0.72)',
    gradient: 'radial-gradient(ellipse at 50% 12%, rgba(46, 168, 132, 0.22) 0%, transparent 55%)',
  },
  ugc: {
    bg: '#121212',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,0.78)',
    gradient: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)',
  },
};

const SceneView: React.FC<{
  scene: ClipScene;
  brandName: string;
  brandColor: string;
  theme: ClipTheme;
  index: number;
}> = ({ scene, brandName, brandColor, theme, index }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const colors = THEMES[theme] ?? THEMES['brand-dark'];
  const brandIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const headlineIn = spring({
    frame: frame - 8,
    fps,
    config: { damping: 16, stiffness: 100 },
  });
  const bodyIn = spring({
    frame: frame - 18,
    fps,
    config: { damping: 16, stiffness: 90 },
  });
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        color: colors.fg,
        fontFamily: '"Vazirmatn", "Tahoma", "Segoe UI", system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill style={{ background: colors.gradient }} />
      <AbsoluteFill
        style={{
          padding: '10% 8%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 22,
          direction: 'rtl',
          textAlign: 'right',
        }}
      >
        <div
          style={{
            opacity: brandIn,
            transform: `translateY(${(1 - brandIn) * 20}px)`,
            fontSize: 26,
            letterSpacing: '0.06em',
            color: brandColor,
            fontWeight: 700,
          }}
        >
          {brandName}
        </div>
        {scene.heading ? (
          <div
            style={{
              opacity: headlineIn,
              transform: `translateY(${(1 - headlineIn) * 28}px)`,
              fontSize: scene.type === 'title' ? 56 : 44,
              lineHeight: 1.3,
              fontWeight: 800,
              maxWidth: '92%',
            }}
          >
            {scene.heading}
          </div>
        ) : null}
        {scene.body ? (
          <div
            style={{
              opacity: bodyIn,
              transform: `translateY(${(1 - bodyIn) * 18}px)`,
              fontSize: 28,
              lineHeight: 1.55,
              color: colors.muted,
              maxWidth: '90%',
            }}
          >
            {scene.body}
          </div>
        ) : null}
        {scene.bullets?.length ? (
          <ul
            style={{
              opacity: bodyIn,
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              fontSize: 28,
              lineHeight: 1.4,
              color: colors.muted,
            }}
          >
            {scene.bullets.map((bullet, i) => (
              <li
                key={`${index}-${i}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    marginTop: 12,
                    borderRadius: 999,
                    backgroundColor: brandColor,
                    flexShrink: 0,
                  }}
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: '6%',
          right: '6%',
          bottom: '4%',
          height: 4,
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            backgroundColor: brandColor,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const HiveGPTClip: React.FC<ClipProps> = ({
  theme,
  brandName,
  brandColor,
  scenes,
  audioSrc,
}) => {
  const { fps } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill>
      {audioSrc ? <Audio src={audioSrc} /> : null}
      {scenes.map((scene, index) => {
        const durationInFrames = Math.max(1, Math.round(scene.durationSec * fps));
        const start = from;
        from += durationInFrames;
        return (
          <Sequence key={`scene-${index}`} from={start} durationInFrames={durationInFrames}>
            <SceneView
              scene={scene}
              brandName={brandName}
              brandColor={brandColor}
              theme={theme}
              index={index}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
