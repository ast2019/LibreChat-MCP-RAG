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

/** Placeholder written to `/api/config` when `VERSION` cannot be read. */
const MISSING_APP_VERSION = '0.0.0';

/**
 * Ancestors to search above the running file. The compiled bundle sits three
 * levels under the image root; the source file sits four. Eight covers both,
 * plus a `node_modules` workspace link.
 */
const MAX_RELEASE_ROOT_DEPTH = 8;

function readTrimmedFile(filePath: string): string | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Nearest ancestor of `startDir` that contains the fork `VERSION` file.
 *
 * tsdown bundles this module into `packages/api/dist/index.cjs`. In the image
 * that directory is `/app/packages/api/dist` (or the workspace link
 * `/app/node_modules/@librechat/api/dist`), while `VERSION` and `CHANGELOG.md`
 * are copied to `/app`. Jest loads the source from `packages/api/src/app`, one
 * directory deeper. A fixed `../../../..` from the bundle is the parent of
 * `/app`, the read fails, and the PWA banner announces version `0.0.0`.
 */
export function findReleaseRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < MAX_RELEASE_ROOT_DEPTH; depth += 1) {
    if (readTrimmedFile(path.join(dir, 'VERSION'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

function releaseRoot(startDir: string): string {
  return findReleaseRoot(startDir) ?? path.resolve(startDir, '../../../..');
}

function repoRoot(): string {
  return releaseRoot(__dirname);
}

function readAppVersions(root: string): AppVersionInfo {
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

  return {
    appVersion: fromFile ?? MISSING_APP_VERSION,
    librechatVersion: fromPackage ?? String(Constants.VERSION),
  };
}

/**
 * Resolves the fork version (`VERSION`) and the upstream LibreChat version
 * (`package.json`). Cached after the first read so `/api/config` stays cheap.
 */
export function resolveAppVersions(): AppVersionInfo {
  if (cachedVersions) {
    return cachedVersions;
  }

  cachedVersions = readAppVersions(repoRoot());
  return cachedVersions;
}

/** Same resolution as {@link resolveAppVersions}, starting from `startDir` instead of this file. */
export function resolveAppVersionsFrom(startDir: string): AppVersionInfo {
  return readAppVersions(releaseRoot(startDir));
}

const HEADING_RE = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const BULLET_RE = /^-\s+\*\*(.+?)\*\*/;

function readChangelog(root: string): ChangelogEntry[] {
  const raw = readTrimmedFile(path.join(root, 'CHANGELOG.md')) ?? '';
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

  return entries;
}

/**
 * Parses Keep-a-Changelog headings from `CHANGELOG.md` into short release
 * notes for the update banner and About tab. Skips `[Unreleased]`.
 */
export function resolveChangelog(limit = 12): ChangelogEntry[] {
  if (cachedChangelog) {
    return cachedChangelog.slice(0, limit);
  }

  cachedChangelog = readChangelog(repoRoot());
  return cachedChangelog.slice(0, limit);
}

/** Same resolution as {@link resolveChangelog}, starting from `startDir` instead of this file. */
export function resolveChangelogFrom(startDir: string, limit = 12): ChangelogEntry[] {
  return readChangelog(releaseRoot(startDir)).slice(0, limit);
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
