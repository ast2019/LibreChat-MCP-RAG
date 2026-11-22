import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SHARED_COPIES,
  composeBuilds,
  defaultImageReference,
  unpinnedImageDefaults,
  differingCopies,
  edgeTtsPin,
  extractTsCodes,
  lastBaseImage,
  missingAptPackages,
  missingCopySources,
  parseAptPackages,
  parseBuildStages,
  parsePackageNames,
  suiteFromImage,
} from './verify-production-build.mts';

const MULTI = `
FROM node:24-alpine AS base
FROM base AS data-provider-build
WORKDIR /app/packages/data-provider
RUN npm run build

FROM base AS api-package-build
WORKDIR /app/packages/api
COPY --from=data-provider-build /a /b
RUN npm run build

FROM base AS client-build
WORKDIR /app/client
RUN npm run build

FROM base AS api-build
WORKDIR /app
RUN npm ci
`;

test('build stages come from the Dockerfile in order, without non-build stages', () => {
  assert.deepEqual(
    parseBuildStages(MULTI).map((stage) => stage.workdir),
    ['packages/data-provider', 'packages/api', 'client'],
  );
});

const REMOTION = `
# comment
FROM node:20-bookworm-slim
RUN apt-get update \\
  && apt-get install -y --no-install-recommends \\
    chromium \\
    fonts-vazirmatn \\
    ffmpeg \\
  && rm -rf /var/lib/apt/lists/*
COPY fonts/Vazirmatn-Regular.ttf /fonts/
COPY --from=other /x /y
COPY missing.json ./
`;

test('a package missing from the base suite is reported (0.38.20 class)', () => {
  const packages = parseAptPackages(REMOTION);
  assert.deepEqual(packages, ['chromium', 'fonts-vazirmatn', 'ffmpeg']);
  const bookworm = parsePackageNames('Package: chromium\nVersion: 1\n\nPackage: ffmpeg\n');
  assert.deepEqual(missingAptPackages(packages, bookworm), ['fonts-vazirmatn']);
});

test('image tags resolve to a suite', () => {
  assert.deepEqual(suiteFromImage('node:20-bookworm-slim'), {
    distro: 'debian',
    suite: 'bookworm',
  });
  assert.deepEqual(suiteFromImage('mcr.microsoft.com/playwright:v1.62.1-noble'), {
    distro: 'ubuntu',
    suite: 'noble',
  });
  assert.equal(suiteFromImage('node:24-alpine'), null);
  assert.equal(suiteFromImage('searxng/searxng:latest'), null);
  assert.equal(lastBaseImage(REMOTION), 'node:20-bookworm-slim');
});

test('a COPY source missing from the context is reported, stage copies are not', () => {
  const present = new Set(['fonts/Vazirmatn-Regular.ttf']);
  assert.deepEqual(
    missingCopySources(REMOTION, (path) => present.has(path)),
    ['missing.json'],
  );
});

test('TypeScript codes are extracted from tsdown output', () => {
  const output =
    'src/debug/share.ts(10,5): error TS9011: Parameter must have an explicit type annotation with --isolatedDeclarations.\nTS9011 again, TS2322';
  assert.deepEqual(extractTsCodes(output), ['TS9011', 'TS2322']);
  assert.deepEqual(extractTsCodes('ok'), []);
});

test('compose builds resolve string and object forms', () => {
  const builds = composeBuilds({
    services: {
      api: { build: { context: '.', dockerfile: 'Dockerfile.multi' } },
      worker: { build: { context: './deploy/remotion' } },
      short: { build: './x' },
      mongo: { image: 'mongo' },
    },
  });
  assert.deepEqual(
    builds.map((b) => [b.name, b.context, b.dockerfile]),
    [
      ['api', '.', 'Dockerfile.multi'],
      ['worker', './deploy/remotion', 'Dockerfile'],
      ['short', './x', 'Dockerfile'],
    ],
  );
});

test('edgeTtsPin reads the pin, its install and the API check', () => {
  const good = [
    'FROM node:20-bookworm-slim',
    'ARG EDGE_TTS_VERSION=7.3.1',
    'RUN apt-get update \\',
    '  && pip3 install --no-cache-dir --break-system-packages edge-tts==${EDGE_TTS_VERSION} \\',
    '  && rm -rf /var/lib/apt/lists/*',
    'COPY src ./src',
    'RUN python3 scripts/check_tts_api.py --version "${EDGE_TTS_VERSION}" --require-live',
  ].join('\n');
  assert.deepEqual(edgeTtsPin(good), { version: '7.3.1', installsPin: true, checksApi: true });
  const drifted = good.replace('edge-tts==${EDGE_TTS_VERSION}', 'edge-tts==7.2.0').replace(/^RUN python3 .*$/m, '');
  assert.deepEqual(edgeTtsPin(drifted), { version: '7.3.1', installsPin: false, checksApi: false });
  assert.equal(edgeTtsPin('FROM x\nRUN pip install edge-tts').version, null);
});

test('differingCopies reports a drifted or missing copy', () => {
  const files: Record<string, string> = { a: 'x', b: 'x', c: 'y' };
  const read = (path: string) => files[path] ?? null;
  assert.deepEqual(differingCopies([['a', 'b']], read), []);
  assert.deepEqual(differingCopies([['a', 'c']], read), ['a and c differ']);
  assert.deepEqual(differingCopies([['a', 'z']], read), ['z is missing']);
  assert.ok(SHARED_COPIES.some(([left]) => left.endsWith('blocklist.mjs')));
});

test('defaultImageReference resolves compose defaults with no variables set', () => {
  assert.equal(defaultImageReference('ghcr.io/a/b:${TAG:-main}'), 'ghcr.io/a/b:main');
  assert.equal(defaultImageReference('a/b:${TAG-1.2}'), 'a/b:1.2');
  assert.equal(defaultImageReference('${IMAGE:?set it}'), '');
  assert.equal(defaultImageReference('${IMAGE}'), '');
  assert.equal(
    defaultImageReference('ghcr.io/a/b:${TAG:-main@sha256:abc}'),
    'ghcr.io/a/b:main@sha256:abc',
  );
});

test('unpinnedImageDefaults flags floating latest/main defaults and untagged images', () => {
  const compose = {
    services: {
      ok: { image: 'redis:7-alpine' },
      pinned: { image: 'ollama/ollama:latest@sha256:abc' },
      pinnedVar: { image: 'ghcr.io/x/y:${TAG:-main@sha256:def}' },
      built: { build: { context: '.' } },
      latest: { image: 'ollama/ollama:latest' },
      main: { image: 'ghcr.io/x/y:${TAG:-main}' },
      bare: { image: 'nginx' },
      registryPort: { image: 'localhost:5000/team/app' },
    },
  };
  assert.deepEqual(unpinnedImageDefaults(compose), [
    'latest: ollama/ollama:latest',
    'main: ghcr.io/x/y:main',
    'bare: nginx',
    'registryPort: localhost:5000/team/app',
  ]);
});
