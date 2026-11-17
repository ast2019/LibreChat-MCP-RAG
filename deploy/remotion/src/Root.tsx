import React from 'react';
import { Composition } from 'remotion';
import { HiveGPTClip, type ClipProps } from './Composition';

const DEFAULT_PROPS: ClipProps = {
  title: 'HiveGPT',
  theme: 'brand-dark',
  brandName: 'HiveGPT',
  brandColor: '#2ea884',
  scenes: [{ type: 'title', durationSec: 5, heading: 'HiveGPT', body: 'Clip' }],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HiveGPTClip"
      component={HiveGPTClip}
      durationInFrames={150}
      fps={30}
      width={405}
      height={720}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={async ({ props }) => {
        const fps = 30;
        const scenes = Array.isArray(props.scenes) ? props.scenes : DEFAULT_PROPS.scenes;
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
  );
};
