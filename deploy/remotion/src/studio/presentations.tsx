import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import type { SceneTransition } from './transitions';
import { clockSweep, fadeOpacity, flipFace, slideOffset, wipeInset } from './transitions';

type Props = { kind: SceneTransition; sign: 1 | -1 };

/** One scene during a transition, drawn so its text never overlaps the other scene's. */
const ScenePresentation: React.FC<TransitionPresentationComponentProps<Props>> = ({
  children,
  presentationDirection: side,
  presentationProgress: progress,
  passedProps: { kind, sign },
}) => {
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
      const { rotation, visible } = flipFace(side, progress, sign);
      outer = { perspective: 1000 };
      style = { transform: `rotateY(${rotation}deg)`, backfaceVisibility: 'hidden', opacity: visible ? 1 : 0 };
      break;
    }
    case 'clock-wipe': {
      const deg = clockSweep(progress);
      const mask =
        side === 'entering'
          ? `conic-gradient(#000 0deg ${deg}deg, transparent ${deg}deg 360deg)`
          : `conic-gradient(transparent 0deg ${deg}deg, #000 ${deg}deg 360deg)`;
      style = { maskImage: mask, WebkitMaskImage: mask };
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
