// Scene transitions never draw two scenes' text over each other (scenes are transparent over
// one shared background, so any overlap of the two layers shows both titles at once).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLIP_EDGE_FADE,
  clockMask,
  clockWipe,
  fadeOpacity,
  flipFace,
  flipPerspective,
  slideOffset,
  wipeInset,
} from '../src/studio/transitions.ts';

const steps = Array.from({ length: 101 }, (_, i) => i / 100);

test('fade runs out, then in: the two scenes are never both visible', () => {
  for (const p of steps) {
    assert.equal(Math.min(fadeOpacity('exiting', p), fadeOpacity('entering', p)), 0, `p=${p}`);
  }
  assert.equal(fadeOpacity('exiting', 0), 1);
  assert.equal(fadeOpacity('entering', 1), 1);
  assert.equal(fadeOpacity('exiting', 0.5) + fadeOpacity('entering', 0.5), 0, 'the midpoint shows only the background');
});

test('slide keeps the scenes exactly one width apart in both directions', () => {
  for (const sign of [1, -1]) {
    for (const p of steps) {
      const gap = Math.abs(slideOffset('entering', p, sign) - slideOffset('exiting', p, sign));
      assert.ok(Math.abs(gap - 100) < 1e-9, `p=${p}`);
    }
  }
});

test('wipe gives each scene its own side of the edge', () => {
  for (const sign of [1, -1]) {
    for (const p of steps) {
      const a = wipeInset('entering', p, sign);
      const b = wipeInset('exiting', p, sign);
      const visibleA = 100 - a.left - a.right;
      const visibleB = 100 - b.left - b.right;
      assert.ok(Math.abs(visibleA + visibleB - 100) < 1e-9, `p=${p}`);
      /** The visible strips touch but do not overlap. */
      const [startA, endA] = [a.left, 100 - a.right];
      const [startB, endB] = [b.left, 100 - b.right];
      assert.ok(endA <= startB + 1e-9 || endB <= startA + 1e-9, `p=${p} sign=${sign}`);
    }
  }
});

/** Fine progress grid plus the exact swap points, where an off-by-one would show both faces. */
const fine = [...Array.from({ length: 1001 }, (_, i) => i / 1000), 0.45, 0.5, 0.55, 0.4999999, 0.5000001];

test('flip shows one face at a time and swaps at exactly 90 degrees', () => {
  for (const sign of [1, -1]) {
    for (const p of fine) {
      const a = flipFace('entering', p, sign);
      const b = flipFace('exiting', p, sign);
      assert.ok(!(a.visible && b.visible), `p=${p}`);
      assert.ok(Math.min(a.opacity, b.opacity) === 0, `p=${p}: both faces have opacity`);
      for (const face of [a, b]) {
        /** A face is only ever drawn turned less than 90°, i.e. front side towards the viewer. */
        assert.equal(face.visible, Math.abs(face.rotation) < 90, `p=${p}`);
        assert.ok(face.visible || face.opacity === 0, `p=${p}: a hidden face is transparent`);
        assert.ok(face.opacity >= 0 && face.opacity <= 1);
      }
    }
    assert.equal(flipFace('exiting', 0.5, sign).visible, false, 'edge-on at the swap');
    assert.equal(flipFace('entering', 0.5, sign).visible, false, 'edge-on at the swap');
    assert.equal(Math.abs(flipFace('exiting', 0.5, sign).rotation), 90);
  }
  assert.deepEqual(flipFace('exiting', 0, 1), { rotation: -0, visible: true, opacity: 1 });
  assert.equal(flipFace('entering', 1, 1).opacity, 1);
});

test('flip fades a face before it is edge-on, so no sheared sliver or ghost of it shows', () => {
  for (const p of fine) {
    for (const side of ['entering', 'exiting']) {
      const face = flipFace(side, p, -1);
      if (Math.abs(face.rotation) > 90 - FLIP_EDGE_FADE) {
        assert.ok(face.opacity < 1, `p=${p} ${side} rotation=${face.rotation}`);
      }
    }
  }
  /** The energy clip's frame 1396 (~73° turned) used to show the title sheared with a faded copy. */
  assert.ok(flipFace('entering', 0.594, -1).opacity < 0.6);
});

test('flip perspective is a few frame sizes away so the turning face stays a mild trapezoid', () => {
  for (const [w, h] of [[720, 1280], [1920, 1080], [1080, 1080]]) {
    assert.ok(flipPerspective(w, h) >= 2 * Math.max(w, h), `${w}x${h}`);
  }
});

test('clock wipe never shows the two scenes at once and never masks the outgoing text', () => {
  for (const p of fine) {
    const out = clockWipe('exiting', p);
    const inc = clockWipe('entering', p);
    assert.equal(out.sweep, null, `p=${p}: the outgoing scene is never cut by the edge`);
    assert.equal(Math.min(out.opacity, inc.opacity), 0, `p=${p}: both scenes visible`);
    assert.ok(!(out.opacity > 0 && inc.sweep !== null && inc.sweep > 0), `p=${p}: sweep started over the outgoing scene`);
  }
  assert.deepEqual(clockWipe('exiting', 0), { opacity: 1, sweep: null });
  assert.equal(clockWipe('exiting', 0.5).opacity, 0);
  assert.deepEqual(clockWipe('entering', 0.5), { opacity: 0, sweep: 0 });
  assert.deepEqual(clockWipe('entering', 1), { opacity: 1, sweep: null }, 'the incoming scene ends unmasked');
});

test('clock wipe sweeps the incoming scene in once, clockwise, after the outgoing one is gone', () => {
  let last = -1;
  for (const p of fine.slice(0, 1001)) {
    const { sweep } = clockWipe('entering', p);
    const deg = sweep === null ? 360 : sweep;
    assert.ok(deg >= last, `p=${p}: the sweep goes backwards`);
    last = deg;
  }
  assert.equal(last, 360);
  assert.ok(clockWipe('entering', 0.775).sweep > 170 && clockWipe('entering', 0.775).sweep < 190, 'half the circle three quarters in');
  assert.equal(clockMask(180), 'conic-gradient(#000 0deg 172deg, transparent 180deg 360deg)');
  assert.equal(clockMask(4), 'conic-gradient(#000 0deg 0deg, transparent 4deg 360deg)');
});

test('sample storyboards name the product HiveGPT in Latin letters', async () => {
  const fixtures = await import('./fixtures.mjs');
  for (const [name, board] of Object.entries(fixtures)) {
    if (board && typeof board === 'object' && Array.isArray(board.scenes)) {
      assert.equal(board.brandName, 'HiveGPT', name);
      assert.ok(!JSON.stringify(board).includes('هایو'), `${name} spells the product in Persian letters`);
    }
  }
});
