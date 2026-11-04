import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import replace from '@rollup/plugin-replace';
import { defineConfig } from 'tsdown';

const require = createRequire(import.meta.url);
const rootPkg = require('../../package.json');
const pkg = require('./package.json');
/** Repo-root `VERSION`. Multi-stage Docker only copies this package unless the
 *  Dockerfile also places `VERSION` at `/app/VERSION` — fall back so the build
 *  still completes when the file is absent. */
function readHivegptVersion() {
  try {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, '../../VERSION'), 'utf8').trim();
    if (text) {
      return text;
    }
  } catch {
    /* missing in some Docker stages */
  }
  return '0.0.0';
}
const hivegptVersion = readHivegptVersion();

export default defineConfig({
  entry: ['src/index.ts', 'src/react-query/index.ts'],
  format: ['cjs', 'esm'],
  platform: 'neutral',
  // Declarations are emitted separately by `tsc -p tsconfig.build.json` (see the
  // `build` script). This package's zod schemas aren't `isolatedDeclarations`-clean,
  // so oxc/bundled-dts isn't viable; plain tsc keeps the rich types and is the only
  // slow step (~2s), while rolldown bundles the JS in ~0.2s.
  dts: false,
  outDir: 'dist',
  sourcemap: true,
  // Warn on module cycles at build time; CI enforces via config/circular-deps.mjs.
  checks: { circularDependency: true },
  deps: {
    // Match the prior Rollup build: bundle nothing third-party. Externalize every
    // bare import (deps, peers, and node built-ins like `crypto`); bundle only the
    // package's own relative/aliased modules.
    neverBundle: (id) => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('src/'),
    onlyBundle: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __IS_DEV__: process.env.NODE_ENV === 'development',
        __LIBRECHAT_VERSION__: rootPkg.version,
        __HIVEGPT_VERSION__: hivegptVersion,
        __DATA_PROVIDER_VERSION__: pkg.version,
      },
    }),
  ],
});
