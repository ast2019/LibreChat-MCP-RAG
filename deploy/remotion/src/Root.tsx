import React from 'react';
import { Composition } from 'remotion';
import { HiveGPTClip, type ClipProps } from './Composition';
import { HiveGPTStyledFilm, STYLED_FILM_META, type StyledFilmProps } from './StyledFilm';
import { STYLES } from './animation-styles/catalog';

const DEFAULT_CLIP: ClipProps = {
  title: 'HiveGPT',
  theme: 'brand-dark',
  brandName: 'HiveGPT',
  brandColor: '#2ea884',
  scenes: [{ type: 'title', durationSec: 5, heading: 'HiveGPT', body: 'Clip' }],
};

const DEFAULT_STYLED: StyledFilmProps = {
  theme: 'chalkboard',
  title: 'HiveGPT',
  brandName: 'HiveGPT',
  brandColor: '#2ea884',
  scenes: [{ type: 'title', durationSec: 5, heading: 'Chalkboard', body: 'Style film' }],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HiveGPTClip"
        component={HiveGPTClip}
        durationInFrames={150}
        fps={30}
        width={405}
        height={720}
        defaultProps={DEFAULT_CLIP}
        calculateMetadata={async ({ props }) => {
          const fps = 30;
          const scenes = Array.isArray(props.scenes) ? props.scenes : DEFAULT_CLIP.scenes;
          const durationSec = scenes.reduce(
            (sum, scene) => sum + Math.max(0.5, Number(scene.durationSec) || 1),
            0,
          );
          return {
            durationInFrames: Math.max(1, Math.round(Math.min(30, durationSec) * fps)),
            fps,
          };
        }}
      />
      <Composition
        id="HiveGPTStyledFilm"
        component={HiveGPTStyledFilm}
        durationInFrames={STYLED_FILM_META.durationInFrames}
        fps={STYLED_FILM_META.fps}
        width={STYLED_FILM_META.width}
        height={STYLED_FILM_META.height}
        defaultProps={DEFAULT_STYLED}
      />
      {/* Upstream style compositions (direct render by id for debugging / future tools). */}
      {STYLES.map((style) => (
        <Composition
          key={style.id}
          id={style.id}
          component={style.component}
          durationInFrames={STYLED_FILM_META.durationInFrames}
          fps={STYLED_FILM_META.fps}
          width={STYLED_FILM_META.width}
          height={STYLED_FILM_META.height}
        />
      ))}
    </>
  );
};
