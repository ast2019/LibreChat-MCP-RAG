import React from 'react';
import { Composition } from 'remotion';
import type { StudioProps } from './studio/types';
import { HiveGPTStudio } from './studio/Studio';

const DEFAULT_PROPS: StudioProps = {
  storyboard: {
    version: 2,
    title: 'HiveGPT',
    lang: 'en',
    aspectRatio: '9:16',
    theme: 'midnight',
    brandName: 'HiveGPT',
    captions: false,
    scenes: [
      { id: 's0', type: 'hook', durationSec: 3, transition: 'fade', headline: 'HiveGPT motion studio' },
    ],
  },
  timeline: { scenes: [{ from: 0, frames: 90, seqFrames: 90, transitionOut: 0 }], totalFrames: 90 },
  icons: {},
  assets: {},
  narration: [],
  words: [],
  size: { width: 720, height: 1280 },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="HiveGPTStudio"
    component={HiveGPTStudio}
    durationInFrames={90}
    fps={30}
    width={720}
    height={1280}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={async ({ props }) => ({
      durationInFrames: Math.max(30, Math.round(Number(props.timeline?.totalFrames) || 90)),
      width: props.size?.width ?? 720,
      height: props.size?.height ?? 1280,
      fps: 30,
    })}
  />
);
