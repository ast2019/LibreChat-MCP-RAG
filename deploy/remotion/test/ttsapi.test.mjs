// The edge-tts API check (scripts/check_tts_api.py) that verify:prod and the Docker build run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check_tts_api.py');
const python = process.env.REMOTION_TTS_PYTHON || 'python3';
const hasPython = spawnSync(python, ['--version']).status === 0;
const pin = /ARG EDGE_TTS_VERSION=(\S+)/.exec(readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'))?.[1];

const check = (args) => spawnSync(python, [SCRIPT, '--version', pin, ...args], { encoding: 'utf8' });

test('the Dockerfile pins edge-tts and installs that version', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.ok(pin, 'ARG EDGE_TTS_VERSION');
  assert.match(dockerfile, /edge-tts==\$\{EDGE_TTS_VERSION\}/);
  assert.match(dockerfile, /check_tts_api\.py --version "\$\{EDGE_TTS_VERSION\}" --require-live/);
});

test("tts.py's edge_tts.Communicate call matches the pinned version", { skip: !hasPython }, () => {
  const result = check([]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a keyword or boundary the pinned version does not accept fails the check', { skip: !hasPython }, async () => {
  const source = readFileSync(path.join(ROOT, 'src', 'tts.py'), 'utf8');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ttsapi-'));
  try {
    const cases = [
      [source.replaceAll('boundary="WordBoundary"', 'boundary="Word"'), /boundary='Word' is not one of/],
      [source.replaceAll('boundary="WordBoundary"', 'word_boundary=True'), /has no word_boundary=/],
      [source.replace('elif chunk["type"] == "WordBoundary":', 'elif chunk["type"] == "Words":'), /never reads WordBoundary chunks/],
    ];
    for (const [text, expected] of cases) {
      const file = path.join(dir, 'tts.py');
      await fs.writeFile(file, text);
      const result = check(['--tts', file]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, expected);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
