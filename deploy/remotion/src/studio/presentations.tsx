import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import type { SceneTransition } from './transitions';
import { clockMask, clockWipe, fadeOpacity, flipFace, flipPerspective, slideOffset, wipeInset } from './transitions';

type Props = { kind: SceneTransition; sign: 1 | -1 };

/** One scene during a transition, drawn so its text never overlaps the other scene's. */
const ScenePresentation: React.FC<TransitionPresentationComponentProps<Props>> = ({
  children,
  presentationDirection: side,
  presentationProgress: progress,
  passedProps: { kind, sign },
}) => {
  const { width, height } = useVideoConfig();
  let style: React.CSSProperties;
  let outer: React.CSSProperties | undefined;
  switch (kind) {
    case 'slide':
      style = { transform: `translateX(${slideOffset(side, progress, sign)}%)` };
      break;
    case 'wipe': {
      const { left, right } = wipeInset(side, progress, sign);
      style = { clipPath: `inset(0 ${right}% 0 ${left}%)` };
      break;
    }
    case 'flip': {
      const { rotation, visible, opacity } = flipFace(side, progress, sign);
      outer = { perspective: flipPerspective(width, height) };
      style = {
        transform: `rotateY(${rotation}deg)`,
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        opacity,
        visibility: visible ? 'visible' : 'hidden',
      };
      break;
    }
    case 'clock-wipe': {
      const { opacity, sweep } = clockWipe(side, progress);
      const mask = sweep === null ? undefined : clockMask(sweep);
      style = { opacity, visibility: opacity > 0 ? 'visible' : 'hidden', ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}) };
      break;
    }
    default:
      style = { opacity: fadeOpacity(side, progress) };
  }
  return (
    <AbsoluteFill style={outer}>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The presentation for a storyboard transition; `rtl` moves slides and wipes the other way. */
export function scenePresentation(kind: SceneTransition, rtl: boolean): TransitionPresentation<Props> {
  return { component: ScenePresentation, props: { kind, sign: rtl ? -1 : 1 } };
}
