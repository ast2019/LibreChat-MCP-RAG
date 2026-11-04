import fs from 'node:fs';
import path from 'node:path';
import { Constants } from 'librechat-data-provider';

export interface AppVersionInfo {
  /** HiveGPT fork semver from the repo `VERSION` file. */
  appVersion: string;
  /** Upstream LibreChat version from root `package.json`. */
  librechatVersion: string;
}

export interface ChangelogEntry {
  version: string;
  date?: string;
  /** First Added/Changed/Fixed bullets, truncated for the banner and About. */
  highlights: string[];
}

export interface AppReleaseInfo extends AppVersionInfo {
  changelog: ChangelogEntry[];
}

let cachedVersions: AppVersionInfo | null = null;
let cachedChangelog: ChangelogEntry[] | null = null;

function repoRoot(): string {
  /** `packages/api/src/app` → repo root (four levels up from this file's dir when compiled to dist). */
  return path.resolve(__dirname, '../../../..');
}

function readTrimmedFile(filePath: string): string | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the fork version (`VERSION`) and the upstream LibreChat version
 * (`package.json`). Cached after the first read so `/api/config` stays cheap.
 */
export function resolveAppVersions(): AppVersionInfo {
  if (cachedVersions) {
    return cachedVersions;
  }

  const root = repoRoot();
  const fromFile = readTrimmedFile(path.join(root, 'VERSION'));
  let fromPackage: string | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      fromPackage = pkg.version.trim();
    }
  } catch {
    fromPackage = null;
  }

  cachedVersions = {
    appVersion: fromFile ?? '0.0.0',
    librechatVersion: fromPackage ?? String(Constants.VERSION),
  };
  return cachedVersions;
}

const HEADING_RE = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const BULLET_RE = /^-\s+\*\*(.+?)\*\*/;

/**
 * Parses Keep-a-Changelog headings from `CHANGELOG.md` into short release
 * notes for the update banner and About tab. Skips `[Unreleased]`.
 */
export function resolveChangelog(limit = 12): ChangelogEntry[] {
  if (cachedChangelog) {
    return cachedChangelog.slice(0, limit);
  }

  const raw = readTrimmedFile(path.join(repoRoot(), 'CHANGELOG.md')) ?? '';
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      if (current && current.version.toLowerCase() !== 'unreleased') {
        entries.push(current);
      }
      current = {
        version: heading[1],
        ...(heading[2] ? { date: heading[2] } : {}),
        highlights: [],
      };
      continue;
    }
    if (!current || current.version.toLowerCase() === 'unreleased') {
      continue;
    }
    if (current.highlights.length >= 6) {
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      current.highlights.push(bullet[1].replace(/\.$/, ''));
    }
  }
  if (current && current.version.toLowerCase() !== 'unreleased') {
    entries.push(current);
  }

  cachedChangelog = entries;
  return cachedChangelog.slice(0, limit);
}

/** Fork version, upstream version, and recent changelog for startup config. */
export function resolveAppReleaseInfo(limit = 12): AppReleaseInfo {
  return {
    ...resolveAppVersions(),
    changelog: resolveChangelog(limit),
  };
}

/** Test hook — clears caches. Not exported from the package barrel. */
export function __resetAppVersionCacheForTests(): void {
  cachedVersions = null;
  cachedChangelog = null;
}
