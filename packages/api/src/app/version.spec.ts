import path from 'node:path';
import {
  resolveAppVersions,
  resolveChangelog,
  __resetAppVersionCacheForTests,
} from './version';

describe('resolveAppVersions', () => {
  beforeEach(() => {
    __resetAppVersionCacheForTests();
  });

  it('reads the fork VERSION file and package.json LibreChat version', () => {
    const info = resolveAppVersions();
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.librechatVersion.length).toBeGreaterThan(0);
    expect(info.appVersion).not.toEqual(info.librechatVersion);
  });

  it('caches the first read', () => {
    const first = resolveAppVersions();
    const second = resolveAppVersions();
    expect(second).toBe(first);
  });
});

describe('resolveChangelog', () => {
  beforeEach(() => {
    __resetAppVersionCacheForTests();
  });

  it('parses Keep-a-Changelog headings and skips Unreleased', () => {
    const entries = resolveChangelog(3);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.version.toLowerCase() !== 'unreleased')).toBe(true);
    expect(entries[0].version).toBe('0.38.1');
    expect(entries[0].highlights.length).toBeGreaterThan(0);
  });

  it('resolves CHANGELOG.md relative to the repo root', () => {
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const changelogPath = path.resolve(__dirname, '../../../../CHANGELOG.md');
    expect(() => fs.accessSync(changelogPath)).not.toThrow();
  });
});
