import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSceneLines, proportionalWords } from '../src/narration.mjs';

test('words are spread over the audio by character count and fill it exactly', () => {
  const words = proportionalWords('aa bbbb cc', 4);
  assert.deepEqual(words, [
    { text: 'aa', startMs: 0, endMs: 1000 },
    { text: 'bbbb', startMs: 1000, endMs: 3000 },
    { text: 'cc', startMs: 3000, endMs: 4000 },
  ]);
});

test('Persian text and empty input are handled', () => {
  const fa = proportionalWords('سلام دنیا', 2);
  assert.equal(fa.length, 2);
  assert.equal(fa.at(-1).endMs, 2000);
  assert.deepEqual(proportionalWords('', 2), []);
  assert.deepEqual(proportionalWords('hello', 0), []);
});

test('scene lines need existing scenes and audio assets', () => {
  const kinds = { a: { kind: 'audio' }, i: { kind: 'image' } };
  assert.deepEqual(parseSceneLines({ 1: 'a', 0: 'a' }, 2, kinds), [
    { index: 0, asset: 'a' },
    { index: 1, asset: 'a' },
  ]);
  assert.equal(parseSceneLines({ 2: 'a' }, 2, kinds), null);
  assert.equal(parseSceneLines({ 0: 'i' }, 2, kinds), null);
  assert.equal(parseSceneLines({ x: 'a' }, 2, kinds), null);
  assert.equal(parseSceneLines({}, 2, kinds), null);
  assert.equal(parseSceneLines(null, 2, kinds), null);
});
