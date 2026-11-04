import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findRepoRoot,
  resolveAppVersions,
  resolveAppVersionsFrom,
  resolveChangelog,
  resolveChangelogFrom,
  __resetAppVersionCacheForTests,
} from './version';

describe('resolveAppVersions', () => {
  beforeEach(() => {
    __resetAppVersionCacheForTests();
  });

  it('reads the fork VERSION file and package.json LibreChat version', () => {
    const info = resolveAppVersions();
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.appVersion).not.toBe('0.0.0');
    expect(info.librechatVersion.length).toBeGreaterThan(0);
    expect(info.appVersion).not.toEqual(info.librechatVersion);
  });

  it('caches the first read', () => {
    const first = resolveAppVersions();
    const second = resolveAppVersions();
    expect(second).toBe(first);
  });
});

describe('findRepoRoot', () => {
  it('finds VERSION from a dist-like layout (three levels up from dist/)', () => {
    const realRoot = path.resolve(__dirname, '../../../..');
    const expected = fs.readFileSync(path.join(realRoot, 'VERSION'), 'utf8').trim();
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hivegpt-version-'));
    const distDir = path.join(sandbox, 'packages', 'api', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'VERSION'), `${expected}\n`);

    try {
      /** Four levels up from dist is outside the sandbox (no VERSION); three levels is. */
      const found = findRepoRoot(distDir, path.join(sandbox, 'api'));
      expect(found).toBe(sandbox);
      expect(fs.readFileSync(path.join(found, 'VERSION'), 'utf8').trim()).toBe(expected);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('still finds VERSION from the source-layout path (src/app)', () => {
    const found = findRepoRoot(__dirname);
    expect(fs.existsSync(path.join(found, 'VERSION'))).toBe(true);
  });
});

describe('resolveChangelog', () => {
  beforeEach(() => {
    __resetAppVersionCacheForTests();
  });

  it('parses Keep-a-Changelog headings and skips Unreleased', () => {
    const entries = resolveChangelog(3);
    const version = fs.readFileSync(path.resolve(__dirname, '../../../../VERSION'), 'utf8').trim();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.version.toLowerCase() !== 'unreleased')).toBe(true);
    expect(entries[0].version).toBe(version);
    expect(entries[0].version).toMatch(/^\d+\.\d+\.\d+/);
    expect(entries[0].highlights.length).toBeGreaterThan(0);
  });

  it('reads VERSION from the image root when started in the compiled bundle', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-release-'));
    try {
      const imageRoot = path.join(scratch, 'app');
      const bundleDir = path.join(imageRoot, 'packages', 'api', 'dist');
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.writeFileSync(path.join(imageRoot, 'VERSION'), '0.38.4\n');
      fs.writeFileSync(
        path.join(imageRoot, 'CHANGELOG.md'),
        [
          '## [Unreleased]',
          '',
          '## [0.38.4] - 2026-11-04',
          '',
          '### Fixed',
          '- **PWA update banner names the release**',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(imageRoot, 'package.json'),
        JSON.stringify({ version: 'v0.8.9-rc1' }),
      );
      // Four levels above `dist` is the parent of the image. That used to be the
      // lookup, so a stray file there became the version on the banner.
      fs.writeFileSync(path.join(scratch, 'VERSION'), '0.0.0\n');
      fs.writeFileSync(
        path.join(scratch, 'CHANGELOG.md'),
        '## [0.0.0] - 2026-11-04\n\n### Fixed\n- **Wrong root**\n',
      );

      expect(path.resolve(bundleDir, '../../../..')).toBe(scratch);
      expect(resolveAppVersionsFrom(bundleDir)).toEqual({
        appVersion: '0.38.4',
        librechatVersion: 'v0.8.9-rc1',
      });
      expect(resolveChangelogFrom(bundleDir, 3)).toEqual([
        {
          version: '0.38.4',
          date: '2026-11-04',
          highlights: ['PWA update banner names the release'],
        },
      ]);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('resolves CHANGELOG.md relative to the repo root', () => {
    const fsActual = jest.requireActual<typeof import('node:fs')>('node:fs');
    const changelogPath = path.resolve(__dirname, '../../../../CHANGELOG.md');
    expect(() => fsActual.accessSync(changelogPath)).not.toThrow();
  });
});
