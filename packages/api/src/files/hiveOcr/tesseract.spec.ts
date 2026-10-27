import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createTesseractRunner } from './tesseract';

describe('createTesseractRunner', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-ocr-'));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function script(name: string, body: string): Promise<string> {
    const file = path.join(dir, name);
    await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  }

  it('reports a missing binary with a clear error', async () => {
    const run = createTesseractRunner({
      binary: path.join(dir, 'no-such-tesseract'),
      languages: 'fas+eng',
      timeoutMs: 5000,
    });
    await expect(run({ image: Buffer.from('png') })).rejects.toMatchObject({
      name: 'OcrError',
      code: 'tesseract_missing',
      message: expect.stringContaining('fas+eng'),
    });
  });

  it('pipes the image on stdin and passes languages, DPI and one thread', async () => {
    const binary = await script(
      'fake-tesseract',
      'echo "args: $*"; echo "threads: $OMP_THREAD_LIMIT"; cat',
    );
    const run = createTesseractRunner({ binary, languages: 'fas+eng', timeoutMs: 5000, dpi: 200 });
    const { text } = await run({ image: Buffer.from('سلام از ورودی') });
    expect(text).toBe('args: stdin stdout -l fas+eng --psm 3 --dpi 200\nthreads: 1\nسلام از ورودی');
  });

  it('explains missing language data', async () => {
    const binary = await script(
      'no-lang',
      'cat > /dev/null; echo "Failed loading language \'fas\'" >&2; exit 1',
    );
    const run = createTesseractRunner({ binary, languages: 'fas', timeoutMs: 5000 });
    await expect(run({ image: Buffer.from('x') })).rejects.toMatchObject({
      code: 'tesseract_failed',
      message: 'Tesseract language data "fas" is not installed',
    });
  });

  it('maps a slow run to `timeout`', async () => {
    const binary = await script('slow', 'sleep 5');
    const run = createTesseractRunner({ binary, languages: 'fas', timeoutMs: 100 });
    await expect(run({ image: Buffer.from('x') })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps a caller abort to `aborted`', async () => {
    const binary = await script('slow-abort', 'sleep 5');
    const run = createTesseractRunner({ binary, languages: 'fas', timeoutMs: 10000 });
    const controller = new AbortController();
    const pending = run({ image: Buffer.from('x'), signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});
