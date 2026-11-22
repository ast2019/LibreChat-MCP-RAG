// Scene transitions that never draw two scenes' text over each other. Scenes are transparent
// over one continuous background, so a plain cross-fade or a reveal that leaves the outgoing
// scene unclipped shows both titles at once. Each transition here either runs the scenes one
// after the other (fade, flip, clock wipe) or gives them disjoint parts of the frame (slide, wipe).
// Pure math only, so the node tests can check the invariant for every progress value.

export type SceneTransition = 'fade' | 'slide' | 'wipe' | 'flip' | 'clock-wipe';
export type Side = 'entering' | 'exiting';

/** Share of a fade spent with neither scene shown: only the background moves. */
export const FADE_GAP = 0.1;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Fade-through: the outgoing scene is gone before the incoming one starts to appear. */
export function fadeOpacity(side: Side, progress: number): number {
  const half = (1 - FADE_GAP) / 2;
  return side === 'exiting' ? clamp01((half - progress) / half) : clamp01((progress - 1 + half) / half);
}

/**
 * Horizontal offset in % of the width; `sign` is +1 when the new scene comes from the right.
 * The two scenes always sit exactly one width apart, so nothing of one covers the other.
 */
export function slideOffset(side: Side, progress: number, sign: 1 | -1): number {
  const p = clamp01(progress);
  return side === 'entering' ? sign * (1 - p) * 100 : -sign * p * 100;
}

/**
 * Wipe as CSS `inset()` edges in %: the incoming scene owns the strip the edge has passed,
 * the outgoing scene owns the rest. `sign` +1 wipes from the right edge.
 */
export function wipeInset(side: Side, progress: number, sign: 1 | -1): { left: number; right: number } {
  const passed = clamp01(progress) * 100;
  if (sign === 1) {
    return side === 'entering' ? { left: 100 - passed, right: 0 } : { left: 0, right: passed };
  }
  return side === 'entering' ? { left: 0, right: 100 - passed } : { left: passed, right: 0 };
}

/** Degrees before edge-on over which a flipping face fades, so a sheared sliver never shows. */
export const FLIP_EDGE_FADE = 30;

/**
 * Flip: rotation in degrees, whether the face is rendered at all, and its opacity. The faces
 * swap at exactly 90°: a face turned to 90° or past it is not rendered (so neither its backface
 * nor a second copy can show), and a face fades out over the last FLIP_EDGE_FADE degrees.
 */
export function flipFace(side: Side, progress: number, sign: 1 | -1): { rotation: number; visible: boolean; opacity: number } {
  const p = clamp01(progress);
  const rotation = side === 'entering' ? sign * 180 * (1 - p) : -sign * 180 * p;
  const visible = Math.abs(rotation) < 90;
  return { rotation, visible, opacity: visible ? clamp01((90 - Math.abs(rotation)) / FLIP_EDGE_FADE) : 0 };
}

/**
 * CSS perspective for a flip, in px. A distance of a few frame sizes keeps the turning face a
 * mild trapezoid; a short one shears the top and bottom rows of text into diagonals.
 */
export function flipPerspective(width: number, height: number): number {
  return 3 * Math.max(width, height);
}

/** Soft edge of the clock wipe, in degrees. */
export const CLOCK_FEATHER = 8;

/**
 * Clock wipe in two halves over the continuous background: the outgoing scene fades out whole
 * (it is never masked, so no edge cuts through its text), then the incoming scene is revealed
 * by a clockwise sweep that starts only after the outgoing one is gone. `sweep` is the degrees
 * the incoming scene owns; `null` means the scene is drawn unmasked.
 */
export function clockWipe(side: Side, progress: number): { opacity: number; sweep: number | null } {
  const half = (1 - FADE_GAP) / 2;
  const p = clamp01(progress);
  if (side === 'exiting') {
    return { opacity: clamp01((half - p) / half), sweep: null };
  }
  const sweep = clamp01((p - 1 + half) / half) * 360;
  return sweep >= 360 ? { opacity: 1, sweep: null } : { opacity: sweep > 0 ? 1 : 0, sweep };
}

/** Mask for the incoming scene's share of the clock, feathered on the moving edge. */
export function clockMask(sweep: number): string {
  const solid = Math.max(0, sweep - CLOCK_FEATHER);
  return `conic-gradient(#000 0deg ${solid}deg, transparent ${sweep}deg 360deg)`;
}
