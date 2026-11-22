import React, { useEffect, useMemo, useState } from 'react';
import { fade } from '@remotion/transitions/fade';
import { flip } from '@remotion/transitions/flip';
import { wipe } from '@remotion/transitions/wipe';
import { slide } from '@remotion/transitions/slide';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useVideoConfig,
} from 'remotion';
import type { TransitionPresentation } from '@remotion/transitions';
import type { Scene, StudioProps, TransitionId } from './types';
import type { Studio } from './layout';
import { EN_FONTS, FA_FONTS, StudioContext, safeArea, useStudio } from './layout';
import { Chart, Stat } from './scenes/data';
import { Compare, Icons, Steps, Timeline } from './scenes/structure';
import { Cta, Hook, List, Logo, Quote } from './scenes/text';
import { Location, Photo, Split } from './scenes/media';
import { Background } from './background';
import { Captions } from './captions';
import { loadFonts } from './fonts';
import { themeFor } from './themes';

const SceneView: React.FC<{ scene: Scene; frames: number }> = ({ scene, frames }) => {
  switch (scene.type) {
    case 'hook':
      return <Hook scene={scene} frames={frames} />;
    case 'stat':
      return <Stat scene={scene} frames={frames} />;
    case 'chart':
      return <Chart scene={scene} frames={frames} />;
    case 'icons':
      return <Icons scene={scene} frames={frames} />;
    case 'steps':
      return <Steps scene={scene} frames={frames} />;
    case 'timeline':
      return <Timeline scene={scene} frames={frames} />;
    case 'compare':
      return <Compare scene={scene} frames={frames} />;
    case 'quote':
      return <Quote scene={scene} frames={frames} />;
    case 'image':
      return <Photo scene={scene} frames={frames} />;
    case 'split':
      return <Split scene={scene} frames={frames} />;
    case 'list':
      return <List scene={scene} frames={frames} />;
    case 'location':
      return <Location scene={scene} frames={frames} />;
    case 'cta':
      return <Cta scene={scene} frames={frames} />;
    case 'logo':
      return <Logo scene={scene} frames={frames} />;
    default:
      return null;
  }
};

function presentation(
  id: TransitionId,
  rtl: boolean,
  width: number,
  height: number,
): TransitionPresentation<Record<string, unknown>> {
  const forward = rtl ? 'from-left' : 'from-right';
  switch (id) {
    case 'slide':
      return slide({ direction: forward }) as TransitionPresentation<Record<string, unknown>>;
    case 'wipe':
      return wipe({ direction: forward }) as TransitionPresentation<Record<string, unknown>>;
    case 'flip':
      return flip({ direction: forward }) as TransitionPresentation<Record<string, unknown>>;
    case 'clock-wipe':
      return clockWipe({ width, height }) as unknown as TransitionPresentation<Record<string, unknown>>;
    default:
      return fade() as TransitionPresentation<Record<string, unknown>>;
  }
}

/** Music level under narration: full between lines, ducked while a voice speaks. */
export function duckedVolume(
  frame: number,
  base: number,
  speech: Array<{ from: number; frames: number }>,
  total: number,
  speechEverywhere: boolean,
): number {
  const ramp = 8;
  let duck = speechEverywhere ? 1 : 0;
  for (const s of speech) {
    const into = interpolate(frame, [s.from - ramp, s.from, s.from + s.frames, s.from + s.frames + ramp], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    duck = Math.max(duck, into);
  }
  const fadeIo = interpolate(frame, [0, 20, total - 45, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return base * (1 - 0.72 * duck) * fadeIo;
}

const BrandMark: React.FC<{ name: string; logo?: string }> = ({ name, logo }) => {
  const { safe, u, theme, fonts, assets } = useStudio();
  const src = logo ? assets[logo]?.src : undefined;
  return (
    <div
      style={{
        position: 'absolute',
        top: Math.max(u * 2, safe.top * 0.38),
        insetInlineStart: safe.start,
        display: 'flex',
        alignItems: 'center',
        gap: u * 1.4,
        opacity: 0.85,
      }}
    >
      {src ? (
        <Img src={src} style={{ height: u * 5, width: u * 5, objectFit: 'contain', borderRadius: u }} />
      ) : (
        <div style={{ width: u * 2.2, height: u * 2.2, borderRadius: '50%', background: theme.accent }} />
      )}
      <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: u * 3, color: theme.text, letterSpacing: '0.02em' }}>{name}</span>
    </div>
  );
};

export const HiveGPTStudio: React.FC<StudioProps> = (props) => {
  const { storyboard, timeline, icons, assets, narration, words, uploadAudio } = props;
  const { width, height, durationInFrames } = useVideoConfig();
  const [handle] = useState(() => delayRender('Loading bundled fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts()
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((error: unknown) => cancelRender(error));
  }, [handle]);

  const studio = useMemo<Studio>(() => {
    const safe = safeArea(storyboard.aspectRatio, width, height);
    const rtl = storyboard.lang === 'fa';
    return {
      width,
      height,
      u: Math.min(width, height) / 100,
      portrait: height > width,
      landscape: width > height * 1.2,
      lang: storyboard.lang,
      rtl,
      theme: themeFor(storyboard.theme, storyboard.brandColor),
      safe,
      box: { width: width - safe.start - safe.end, height: height - safe.top - safe.bottom },
      icons,
      assets,
      fonts: rtl ? FA_FONTS : EN_FONTS,
    };
  }, [storyboard, width, height, icons, assets]);

  if (!ready) {
    return null;
  }
  const music = storyboard.music;
  return (
    <StudioContext.Provider value={studio}>
      <AbsoluteFill style={{ background: studio.theme.base[0] }}>
        <Background seed={storyboard.title} />
        <TransitionSeries>
          {storyboard.scenes.map((scene, i) => {
            const entry = timeline.scenes[i];
            const next = storyboard.scenes[i + 1];
            return (
              <React.Fragment key={scene.id}>
                <TransitionSeries.Sequence durationInFrames={entry.seqFrames} name={`${scene.type} ${i + 1}`}>
                  <SceneView scene={scene} frames={entry.frames} />
                </TransitionSeries.Sequence>
                {next && entry.transitionOut > 0 ? (
                  <TransitionSeries.Transition
                    presentation={presentation(next.transition, studio.rtl, width, height)}
                    timing={linearTiming({ durationInFrames: entry.transitionOut, easing: Easing.inOut(Easing.cubic) })}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </TransitionSeries>
        <BrandMark name={storyboard.brandName} logo={storyboard.logo} />
        {storyboard.captions && words.length > 0 ? <Captions words={words} /> : null}
        {narration.map((clip, i) => (
          <Sequence key={i} from={clip.from} durationInFrames={clip.frames} layout="none">
            <Html5Audio src={clip.src} />
          </Sequence>
        ))}
        {uploadAudio ? <Html5Audio src={uploadAudio} /> : null}
        {music ? (
          <Html5Audio
            src={staticFile(`music/${music.track}.mp3`)}
            loop
            volume={(f) => duckedVolume(f, music.volume, narration, durationInFrames, Boolean(uploadAudio))}
          />
        ) : null}
      </AbsoluteFill>
    </StudioContext.Provider>
  );
};
