// Scene transitions that never draw two scenes' text over each other. Scenes are transparent
// over one continuous background, so a plain cross-fade or a reveal that leaves the outgoing
// scene unclipped shows both titles at once. Each transition here either runs the scenes one
// after the other (fade, flip) or gives them disjoint parts of the frame (slide, wipe, clock).
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

/** Flip rotation in degrees and whether that face is shown (a face turned past 90° is hidden). */
export function flipFace(side: Side, progress: number, sign: 1 | -1): { rotation: number; visible: boolean } {
  const p = clamp01(progress);
  const rotation = side === 'entering' ? sign * 180 * (1 - p) : -sign * 180 * p;
  return { rotation, visible: Math.abs(rotation) < 90 };
}

/** Clock wipe: degrees of the circle the incoming scene owns; the outgoing owns the rest. */
export function clockSweep(progress: number): number {
  return clamp01(progress) * 360;
}
