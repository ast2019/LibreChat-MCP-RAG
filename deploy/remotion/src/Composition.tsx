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
import { ThemeDecor } from './decorations';
import {
  resolveAccent,
  resolveTheme,
  THEME_VISUALS,
  type ClipTheme,
  type SceneType,
} from './themes';

export type { ClipTheme, SceneType };

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

const BulletMark: React.FC<{
  shape: (typeof THEME_VISUALS)[ClipTheme]['bulletShape'];
  color: string;
}> = ({ shape, color }) => {
  if (shape === 'square' || shape === 'pixel' || shape === 'brick') {
    return (
      <span
        style={{
          width: shape === 'brick' ? 16 : 12,
          height: shape === 'brick' ? 10 : 12,
          marginTop: 10,
          borderRadius: shape === 'brick' ? 2 : 0,
          backgroundColor: color,
          flexShrink: 0,
          boxShadow: shape === 'brick' ? 'inset 0 1px 0 rgba(255,255,255,0.35)' : undefined,
        }}
      />
    );
  }
  if (shape === 'dash' || shape === 'chalk') {
    return (
      <span
        style={{
          width: 16,
          height: shape === 'chalk' ? 3 : 2,
          marginTop: 14,
          backgroundColor: color,
          flexShrink: 0,
          opacity: 0.9,
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 10,
        height: 10,
        marginTop: 12,
        borderRadius: 999,
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
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
  const visual = THEME_VISUALS[theme] ?? THEME_VISUALS['brand-dark'];
  const accent = resolveAccent(theme, brandColor);
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
  const centered = visual.textAlign === 'center';
  const contentTop = visual.decor === 'orbit' ? '52%' : undefined;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: visual.bg,
        color: visual.fg,
        fontFamily: visual.fontFamily,
        overflow: 'hidden',
        border: visual.border,
        boxSizing: 'border-box',
      }}
    >
      {visual.gradient !== 'none' ? (
        <AbsoluteFill style={{ background: visual.gradient }} />
      ) : null}
      <ThemeDecor kind={visual.decor} accent={accent} />
      <AbsoluteFill
        style={{
          padding: centered ? '8% 10%' : '10% 8%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: centered ? 'flex-end' : 'center',
          alignItems: centered ? 'center' : undefined,
          gap: 22,
          direction: visual.direction ?? 'rtl',
          textAlign: visual.textAlign ?? 'right',
          paddingTop: contentTop,
        }}
      >
        <div
          style={{
            opacity: brandIn,
            transform: `translateY(${(1 - brandIn) * 20}px)`,
            fontSize: visual.brandSize,
            letterSpacing: visual.letterSpacing ?? '0.06em',
            color: accent,
            fontWeight: visual.fontWeight ?? 700,
            textShadow: visual.textShadow,
          }}
        >
          {brandName}
        </div>
        {scene.heading ? (
          <div
            style={{
              opacity: headlineIn,
              transform: `translateY(${(1 - headlineIn) * 28}px)`,
              fontSize: scene.type === 'title' ? visual.titleSize : visual.headingSize,
              lineHeight: 1.3,
              fontWeight: visual.fontWeight ?? 800,
              maxWidth: centered ? '88%' : '92%',
              textShadow: visual.textShadow,
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
              fontSize: visual.bodySize,
              lineHeight: 1.55,
              color: visual.muted,
              maxWidth: centered ? '86%' : '90%',
              textShadow: visual.textShadow,
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
              fontSize: visual.bodySize,
              lineHeight: 1.4,
              color: visual.muted,
              alignItems: centered ? 'center' : undefined,
              maxWidth: '92%',
            }}
          >
            {scene.bullets.map((bullet, i) => (
              <li
                key={`${index}-${i}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  textAlign: visual.textAlign ?? 'right',
                }}
              >
                <BulletMark shape={visual.bulletShape} color={accent} />
                <span style={{ textShadow: visual.textShadow }}>{bullet}</span>
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
          height: visual.bulletShape === 'pixel' ? 6 : 4,
          backgroundColor: visual.progressTrack,
          borderRadius: visual.bulletShape === 'pixel' ? 0 : 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            backgroundColor: accent,
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
  const resolved = resolveTheme(theme);
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
              theme={resolved}
              index={index}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
