// Scene transitions never draw two scenes' text over each other (scenes are transparent over
// one shared background, so any overlap of the two layers shows both titles at once).
import assert from 'node:assert/strict';
import test from 'node:test';
import { clockSweep, fadeOpacity, flipFace, slideOffset, wipeInset } from '../src/studio/transitions.ts';

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

test('flip shows one face at a time', () => {
  for (const sign of [1, -1]) {
    for (const p of steps) {
      assert.ok(!(flipFace('entering', p, sign).visible && flipFace('exiting', p, sign).visible), `p=${p}`);
    }
  }
  assert.equal(flipFace('exiting', 0, 1).visible, true);
  assert.equal(flipFace('entering', 1, 1).visible, true);
});

test('clock wipe sweeps the whole circle once', () => {
  assert.equal(clockSweep(0), 0);
  assert.equal(clockSweep(0.5), 180);
  assert.equal(clockSweep(1), 360);
  assert.equal(clockSweep(2), 360);
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
