/**
 * Local production-build guard (`npm run verify:prod`).
 *
 * `tsc --noEmit` and jest do not run what the Docker image runs: `tsdown` builds
 * `packages/api` with isolated declarations (TS9011 in 0.38.11 and 0.39.0), and an
 * `apt-get install` of a package missing from the base image's Debian suite fails
 * only inside `docker build` (0.38.20). This script runs those steps without Docker
 * wherever it can, and says SKIPPED, never "passed", for what needs a daemon.
 *
 * Usage: node scripts/verify-production-build.mts [--client] [--images] [--quick]
 *   --client  also run the heavy vite client build (NODE_MAX_OLD_SPACE_SIZE, default 6144)
 *   --images  also build Dockerfile.multi --target api-build (needs a docker daemon)
 *   --quick   static Dockerfile/compose checks only (no package builds, no tests)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ pure helpers

/** Joins `\` continuations and drops comments and blank lines. */
export function logicalLines(dockerfile: string): string[] {
  const lines: string[] = [];
  let pending = '';
  for (const raw of dockerfile.split(/\r?\n/)) {
    const line = raw.trim();
    if (!pending && (line === '' || line.startsWith('#'))) continue;
    if (pending && line.startsWith('#')) continue;
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    lines.push(`${pending}${line}`.trim());
    pending = '';
  }
  if (pending) lines.push(pending.trim());
  return lines;
}

export interface BuildStage {
  name: string;
  workdir: string;
}

/**
 * The package build stages of Dockerfile.multi in file order: a stage that sets a
 * WORKDIR under /app and runs `npm run build`. Reading them here keeps this guard
 * from drifting when the Dockerfile gains or reorders a package.
 */
export function parseBuildStages(dockerfile: string): BuildStage[] {
  const stages: BuildStage[] = [];
  let current: { name: string; workdir: string; builds: boolean } | null = null;
  const flush = (): void => {
    if (current?.builds && current.workdir.startsWith('/app/')) {
      stages.push({ name: current.name, workdir: current.workdir.slice('/app/'.length) });
    }
  };
  for (const line of logicalLines(dockerfile)) {
    const from = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
    if (from) {
      flush();
      current = { name: from[1], workdir: '', builds: false };
    } else if (current) {
      const workdir = /^WORKDIR\s+(\S+)/i.exec(line);
      if (workdir) current.workdir = workdir[1];
      if (/^RUN\s+npm run build\s*$/i.test(line)) current.builds = true;
    }
  }
  flush();
  return stages;
}

export interface CopyInstruction {
  sources: string[];
  fromStage: boolean;
}

/** COPY/ADD instructions; `--from=` copies read another stage, not the context. */
export function parseCopies(dockerfile: string): CopyInstruction[] {
  const copies: CopyInstruction[] = [];
  for (const line of logicalLines(dockerfile)) {
    const match = /^(?:COPY|ADD)\s+(.*)$/i.exec(line);
    if (!match) continue;
    const tokens = match[1].split(/\s+/).filter(Boolean);
    const flags = tokens.filter((token) => token.startsWith('--'));
    const rest = tokens.filter((token) => !token.startsWith('--'));
    if (rest.length < 2) continue;
    copies.push({
      sources: rest.slice(0, -1),
      fromStage: flags.some((flag) => flag.startsWith('--from=')),
    });
  }
  return copies;
}

/** Context COPY sources that do not exist (globs and URLs are not checked). */
export function missingCopySources(
  dockerfile: string,
  exists: (relativePath: string) => boolean,
): string[] {
  const missing: string[] = [];
  for (const copy of parseCopies(dockerfile)) {
    if (copy.fromStage) continue;
    for (const source of copy.sources) {
      if (/[*?[]|^https?:|\$/.test(source)) continue;
      if (!exists(source.replace(/^\.\//, ''))) missing.push(source);
    }
  }
  return missing;
}

/** Package names passed to `apt-get install` (or `apt install`) in a Dockerfile. */
export function parseAptPackages(dockerfile: string): string[] {
  const packages = new Set<string>();
  for (const line of logicalLines(dockerfile)) {
    if (!/^RUN\b/i.test(line)) continue;
    for (const command of line.split(/&&|;|\|\|/)) {
      const match = /\bapt(?:-get)?\s+install\s+(.*)$/.exec(command.trim());
      if (!match) continue;
      for (const token of match[1].split(/\s+/)) {
        if (!token || token.startsWith('-') || token.includes('$') || token === '\\') continue;
        packages.add(token.replace(/=.*$/, '').replace(/:[a-z0-9]+$/, ''));
      }
    }
  }
  return [...packages];
}

export interface Suite {
  distro: 'debian' | 'ubuntu';
  suite: string;
}

const DEBIAN_SUITES = ['bullseye', 'bookworm', 'trixie', 'sid', 'buster'];
const UBUNTU_SUITES = ['focal', 'jammy', 'noble', 'oracular', 'plucky', 'questing'];

/** The Debian/Ubuntu suite named by an image tag, or null (alpine, `latest`, unknown). */
export function suiteFromImage(image: string): Suite | null {
  const tag = image.split(':').slice(1).join(':');
  if (!tag) return null;
  const parts = tag.split(/[-_]/);
  for (const part of parts) {
    if (DEBIAN_SUITES.includes(part)) return { distro: 'debian', suite: part };
    if (UBUNTU_SUITES.includes(part)) return { distro: 'ubuntu', suite: part };
  }
  return null;
}

/** The final FROM image of a Dockerfile (the one `apt-get` in it installs into). */
export function lastBaseImage(dockerfile: string): string | null {
  const froms = logicalLines(dockerfile)
    .map((line) => /^FROM\s+(?:--\S+\s+)?(\S+)/i.exec(line)?.[1])
    .filter((image): image is string => Boolean(image));
  return froms.at(-1) ?? null;
}

/** Binary package names from a Debian `Packages` index. */
export function parsePackageNames(index: string): Set<string> {
  const names = new Set<string>();
  for (const match of index.matchAll(/^Package:\s*(\S+)/gm)) names.add(match[1]);
  return names;
}

/** Packages absent from the suite's index: the 0.38.20 failure class. */
export function missingAptPackages(packages: string[], available: Set<string>): string[] {
  return packages.filter((name) => !available.has(name));
}

/** Index URLs that together list what `apt-get install` can reach in a suite. */
export function packageIndexUrls({ distro, suite }: Suite): string[] {
  if (distro === 'debian') {
    return [
      `https://deb.debian.org/debian/dists/${suite}/main/binary-amd64/Packages.gz`,
      `https://deb.debian.org/debian/dists/${suite}-updates/main/binary-amd64/Packages.gz`,
    ];
  }
  const urls: string[] = [];
  for (const pocket of [suite, `${suite}-updates`, `${suite}-security`]) {
    for (const area of ['main', 'universe']) {
      urls.push(
        `https://archive.ubuntu.com/ubuntu/dists/${pocket}/${area}/binary-amd64/Packages.gz`,
      );
    }
  }
  return urls;
}

/** Distinct TypeScript diagnostic codes (TS9011, ...) found in build output. */
export function extractTsCodes(output: string): string[] {
  return [...new Set([...output.matchAll(/\bTS\d{4,5}\b/g)].map((match) => match[0]))];
}

export interface ComposeService {
  name: string;
  context: string;
  dockerfile: string;
}

/** Compose services with a `build`, with the context and Dockerfile resolved against the repo. */
export function composeBuilds(compose: unknown): ComposeService[] {
  const services = (compose as { services?: Record<string, { build?: unknown }> })?.services ?? {};
  const builds: ComposeService[] = [];
  for (const [name, service] of Object.entries(services)) {
    const build = service?.build;
    if (!build) continue;
    if (typeof build === 'string') {
      builds.push({ name, context: build, dockerfile: 'Dockerfile' });
    } else {
      const { context = '.', dockerfile = 'Dockerfile' } = build as {
        context?: string;
        dockerfile?: string;
      };
      builds.push({ name, context, dockerfile });
    }
  }
  return builds;
}

// ---------------------------------------------------------------- runner

type Status = 'pass' | 'fail' | 'skipped';

interface StepResult {
  title: string;
  status: Status;
  detail: string;
  seconds: number;
}

const results: StepResult[] = [];

function record(title: string, status: Status, detail: string, started: number): void {
  const seconds = (Date.now() - started) / 1000;
  results.push({ title, status, detail, seconds });
  const mark = status === 'pass' ? 'PASS   ' : status === 'fail' ? 'FAIL   ' : 'SKIPPED';
  console.log(`${mark} ${title} (${seconds.toFixed(1)}s)${detail ? `\n${indent(detail)}` : ''}`);
}

function indent(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');
}

function tail(text: string, lines = 40): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.error ? 1 : (result.status ?? 1), output };
}

function runBuildStep(title: string, command: string, args: string[], cwd: string, env = {}) {
  const started = Date.now();
  const { status, output } = run(command, args, cwd, env);
  if (status === 0) return record(title, 'pass', '', started);
  const codes = extractTsCodes(output);
  const head = codes.length > 0 ? `TypeScript errors: ${codes.join(', ')}\n` : '';
  record(title, 'fail', `${head}${tail(output)}`, started);
}

function readText(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

async function loadYaml(text: string): Promise<unknown> {
  const { load } = (await import('js-yaml')) as { load: (source: string) => unknown };
  return load(text);
}

async function fetchIndex(url: string): Promise<Set<string>> {
  const cache = join(tmpdir(), 'hivegpt-verify-prod');
  mkdirSync(cache, { recursive: true });
  const file = join(cache, url.replace(/[^a-z0-9.]+/gi, '_'));
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 24 * 3600 * 1000) {
    return parsePackageNames(readFileSync(file, 'utf8'));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404) return new Set();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
  writeFileSync(file, text);
  return parsePackageNames(text);
}

async function checkAptPackages(dockerfilePath: string): Promise<void> {
  const title = `apt packages exist in base suite: ${dockerfilePath}`;
  const started = Date.now();
  const text = readText(dockerfilePath);
  const packages = parseAptPackages(text);
  if (packages.length === 0) return;
  const image = lastBaseImage(text) ?? '';
  const suite = suiteFromImage(image);
  if (!suite) {
    return record(
      title,
      'skipped',
      `cannot resolve a Debian/Ubuntu suite from "${image}"`,
      started,
    );
  }
  try {
    const available = new Set<string>();
    for (const url of packageIndexUrls(suite)) {
      for (const name of await fetchIndex(url)) available.add(name);
    }
    const missing = missingAptPackages(packages, available);
    if (missing.length > 0) {
      return record(
        title,
        'fail',
        `not in ${suite.distro} ${suite.suite}: ${missing.join(', ')} (base image ${image})`,
        started,
      );
    }
    record(
      title,
      'pass',
      `${packages.length} package(s) in ${suite.distro} ${suite.suite}`,
      started,
    );
  } catch (error) {
    record(title, 'skipped', `offline or index unreachable: ${(error as Error).message}`, started);
  }
}

async function staticDockerChecks(): Promise<ComposeService[]> {
  let started = Date.now();
  const composeText = readText('docker-compose.yml');
  let builds: ComposeService[] = [];
  const problems: string[] = [];
  try {
    builds = composeBuilds(await loadYaml(composeText));
  } catch (error) {
    problems.push(`docker-compose.yml does not parse: ${(error as Error).message}`);
  }
  for (const build of builds) {
    const dockerfile = join(build.context, build.dockerfile);
    if (!existsSync(resolve(ROOT, dockerfile))) {
      problems.push(`${build.name}: ${dockerfile} does not exist`);
    }
  }
  record(
    'compose parses and every build has a Dockerfile',
    problems.length > 0 ? 'fail' : 'pass',
    problems.join('\n') || `${builds.length} build(s)`,
    started,
  );

  started = Date.now();
  const copyProblems: string[] = [];
  for (const build of builds) {
    const dockerfile = join(build.context, build.dockerfile);
    if (!existsSync(resolve(ROOT, dockerfile))) continue;
    const base = resolve(ROOT, build.context);
    for (const source of missingCopySources(readText(dockerfile), (path) =>
      existsSync(resolve(base, path)),
    )) {
      copyProblems.push(`${dockerfile}: COPY source "${source}" not found in ${build.context}`);
    }
  }
  record(
    'Dockerfile COPY sources exist',
    copyProblems.length > 0 ? 'fail' : 'pass',
    copyProblems.join('\n'),
    started,
  );

  const dockerfiles = new Set(
    builds
      .map((build) => join(build.context, build.dockerfile))
      .filter((p) => p.startsWith('deploy/') || p.startsWith('./deploy/')),
  );
  for (const dockerfile of [...dockerfiles].map((path) => path.replace(/^\.\//, ''))) {
    if (existsSync(resolve(ROOT, dockerfile))) await checkAptPackages(dockerfile);
  }
  return builds;
}

function dockerDaemonUp(): boolean {
  return run('docker', ['info'], ROOT).status === 0;
}

async function main(): Promise<number> {
  const flags = process.argv.slice(2);
  const known = new Set(['--client', '--images', '--quick']);
  const unknown = flags.filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    console.error(`verify-production-build: unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  const quick = flags.includes('--quick');
  const total = Date.now();

  if (!quick) {
    const stages = parseBuildStages(readText('Dockerfile.multi')).filter((stage) =>
      stage.workdir.startsWith('packages/'),
    );
    if (stages.length === 0) {
      record('Dockerfile.multi package build stages found', 'fail', 'no stage parsed', Date.now());
    }
    for (const stage of stages) {
      runBuildStep(
        `npm run build in ${stage.workdir} (stage ${stage.name})`,
        'npm',
        ['run', 'build'],
        resolve(ROOT, stage.workdir),
      );
    }
    if (flags.includes('--client')) {
      runBuildStep(
        'npm run build in client (vite)',
        'npm',
        ['run', 'build'],
        resolve(ROOT, 'client'),
        {
          NODE_OPTIONS: `--max-old-space-size=${process.env.NODE_MAX_OLD_SPACE_SIZE ?? '6144'}`,
        },
      );
    }
    runBuildStep(
      'tool registry specs (packages/api)',
      'npx',
      ['jest', 'src/tools/definitions.spec.ts', 'src/tools/registry'],
      resolve(ROOT, 'packages/api'),
    );
    runBuildStep(
      'remotion worker tests',
      process.execPath,
      ['--test', ...['diagnostics', 'e2e', 'server', 'storyboard'].map((n) => `test/${n}.test.mjs`)],
      resolve(ROOT, 'deploy/remotion'),
    );
  }

  const builds = await staticDockerChecks();

  const started = Date.now();
  if (dockerDaemonUp()) {
    for (const build of builds.filter((b) => b.context.includes('deploy/'))) {
      const context = resolve(ROOT, build.context);
      runBuildStep(
        `docker build ${build.name}`,
        'docker',
        [
          'build',
          '-f',
          resolve(context, build.dockerfile),
          '-t',
          `verify-prod/${build.name}`,
          context,
        ],
        ROOT,
      );
    }
    if (flags.includes('--images')) {
      runBuildStep(
        'docker build Dockerfile.multi --target api-build',
        'docker',
        ['build', '-f', 'Dockerfile.multi', '--target', 'api-build', '-t', 'verify-prod/api', '.'],
        ROOT,
      );
    }
  } else {
    record(
      'docker image builds',
      'skipped',
      'SKIPPED: docker daemon unavailable (docker info failed); no image was built',
      started,
    );
  }

  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skipped');
  const seconds = ((Date.now() - total) / 1000).toFixed(1);
  console.log(
    `\nverify:prod ${failed.length > 0 ? 'FAILED' : 'passed'} in ${seconds}s: ` +
      `${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} SKIPPED (not verified)`,
  );
  for (const item of failed) console.log(`  - ${item.title}`);
  return failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
