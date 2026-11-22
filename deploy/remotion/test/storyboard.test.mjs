import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledCoverage, missingGlyphs } from '../src/glyphs.mjs';
import { FALLBACK_ICON, iconCount, resolveIcon } from '../src/icons.mjs';
import {
  SCENE_TYPES,
  TRANSITION_FRAMES,
  computeTimeline,
  dimensionsFor,
  validateStoryboard,
} from '../src/storyboard.mjs';
import { everySceneEn, everySceneFa } from './fixtures.mjs';

const assets = { photo: { kind: 'image' } };

test('the sample storyboards cover every scene type and validate cleanly', () => {
  const covered = new Set([...everySceneEn.scenes, ...everySceneFa.scenes].map((s) => s.type));
  assert.deepEqual([...covered].sort(), [...SCENE_TYPES].sort());
  for (const board of [everySceneEn, everySceneFa]) {
    const result = validateStoryboard(board, { assets });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.warnings, []);
  }
  assert.equal(validateStoryboard(everySceneFa, { assets }).storyboard.lang, 'fa');
});

test('invalid input returns precise paths', () => {
  const result = validateStoryboard(
    {
      title: 'x',
      scenes: [
        { type: 'chart', durationSec: 3, chart: 'pie', data: [{ label: 'a', value: 'ten' }, { label: 'b', value: -1 }] },
        { type: 'hook', durationSec: 0.2 },
        { type: 'stat', durationSec: 2, label: 'n' },
        { type: 'nope', durationSec: 2 },
        { type: 'image', durationSec: 2, image: 'missing' },
      ],
    },
    { assets },
  );
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  assert.match(text, /scenes\[0\]\.data\[0\]\.value: must be a number/);
  assert.match(text, /scenes\[0\]\.data\[1\]\.value: must be between 0/);
  assert.match(text, /scenes\[1\]\.durationSec: must be between 1 and 30/);
  assert.match(text, /scenes\[1\]\.headline: is required/);
  assert.match(text, /scenes\[2\]\.value: is required/);
  assert.match(text, /scenes\[3\]\.type: must be one of hook, stat/);
  assert.match(text, /scenes\[4\]\.image: asset "missing" was not sent/);
});

test('the total length is capped by maxDurationSec (hard cap 180)', () => {
  const scenes = Array.from({ length: 7 }, () => ({ type: 'hook', durationSec: 30, headline: 'a' }));
  const over = validateStoryboard({ title: 't', scenes }, { maxDurationSec: 500 });
  assert.equal(over.ok, false);
  assert.match(over.errors.join(), /add up to 210s; the limit is 180s/);
  const ok = validateStoryboard({ title: 't', scenes: scenes.slice(0, 3) }, { maxDurationSec: 90 });
  assert.equal(ok.ok, true);
  const tight = validateStoryboard({ title: 't', scenes: scenes.slice(0, 4) }, { maxDurationSec: 90 });
  assert.match(tight.errors.join(), /limit is 90s/);
});

test('unknown icon names fall back with a warning and never fail', () => {
  assert.ok(iconCount() > 4000);
  assert.deepEqual(resolveIcon('solar-panel'), { name: 'solar-panel', known: true });
  assert.deepEqual(resolveIcon('Solar Panel'), { name: 'solar-panel', known: true });
  assert.deepEqual(resolveIcon('energy'), { name: 'bolt', known: true });
  assert.deepEqual(resolveIcon('definitely-not-an-icon'), { name: FALLBACK_ICON, known: false });
  const result = validateStoryboard({
    title: 't',
    scenes: [{ type: 'icons', durationSec: 3, items: [{ icon: 'zzz-unknown', label: 'a' }, { icon: 'bolt', label: 'b' }] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.storyboard.scenes[0].items[0].icon, FALLBACK_ICON);
  assert.match(result.warnings[0], /^unknown_icon: scenes\[0\]\.items\[0\]\.icon "zzz-unknown" -> sparkles/);
  assert.ok(result.icons.includes('bolt'));
});

test('legacy theme ids (brand shells and chai style films) fall back with a warning', () => {
  for (const [legacy, mapped] of [['brand-dark', 'midnight'], ['claymation', 'sunset'], ['made-up', 'midnight']]) {
    const result = validateStoryboard({ title: 't', theme: legacy, scenes: [{ type: 'hook', durationSec: 2, headline: 'a' }] });
    assert.equal(result.ok, true);
    assert.equal(result.storyboard.theme, mapped);
    assert.match(result.warnings[0], /^unknown_theme/);
  }
});

test('bundled fonts cover Persian text, Persian digits and Latin; missing glyphs are reported', () => {
  const persian = [...everySceneFa.scenes.flatMap((s) => JSON.stringify(s)), 'ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىيپچژکگی‌۰۱۲۳۴۵۶۷۸۹٪٬٫«»؟،؛'].join('');
  assert.deepEqual(missingGlyphs(persian), []);
  assert.deepEqual(missingGlyphs('The quick brown fox — 1,234.5% €£'), []);
  assert.deepEqual(missingGlyphs('漢字'), ['漢', '字']);
  assert.ok(bundledCoverage().has(0x06cc) && bundledCoverage().has(0x200c));
  const result = validateStoryboard({ title: 'ok', scenes: [{ type: 'hook', durationSec: 2, headline: '漢字' }] });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(), /missing_glyphs: 漢 字/);
});

test('timeline: scenes include their outgoing transition, the total equals the scene sum', () => {
  const timeline = computeTimeline([
    { durationSec: 2, transition: 'fade' },
    { durationSec: 3, transition: 'slide' },
    { durationSec: 1, transition: 'none' },
  ]);
  assert.equal(timeline.totalFrames, 180);
  assert.deepEqual(timeline.scenes.map((s) => s.from), [0, 60, 150]);
  assert.equal(timeline.scenes[0].seqFrames, 60 + TRANSITION_FRAMES);
  assert.equal(timeline.scenes[1].transitionOut, 0);
});

test('dimensions per aspect ratio are even and use the short side', () => {
  assert.deepEqual(dimensionsFor('9:16', 720), { width: 720, height: 1280 });
  assert.deepEqual(dimensionsFor('16:9', 720), { width: 1280, height: 720 });
  assert.deepEqual(dimensionsFor('1:1', 720), { width: 720, height: 720 });
  assert.deepEqual(dimensionsFor('4:5', 720), { width: 720, height: 900 });
});
