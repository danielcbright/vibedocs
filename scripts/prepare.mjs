#!/usr/bin/env node
// Runs on every `npm install` via the package.json "prepare" lifecycle script.
//
// Why this exists: `prepare` is the only lifecycle hook npm fires when a package
// is installed as a git dependency (`npm install github:danielcbright/vibedocs#…`),
// so the published-package path genuinely needs it to build `frontend/dist/`. But
// `prepare` ALSO fires on every self-install in the source repo (e.g. a dev running
// `npm install some-new-dep`), and the ~12s Vite build there is pure waste.
//
// The decision of whether to run that build lives in `planPrepare`
// (scripts/prepare-plan.mjs) so it can be unit-tested — this file is just the
// side-effecting shell around it. In every case we still run `build:cli`
// (cheap tsc) and `husky` (so dev hooks and the consumer CLI both work).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { planPrepare } from './prepare-plan.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : null;
const plan = planPrepare({ initCwd, packageDir, npmCommand: process.env.npm_command });

function run(label, command, args, { optional = false } = {}) {
  console.log(`[prepare] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: packageDir, shell: false });
  if (result.error) {
    if (optional) {
      console.log(`[prepare] ${label} unavailable (${result.error.message}) — skipping`);
      return;
    }
    throw result.error;
  }
  if (result.status !== 0) {
    if (optional) {
      console.log(`[prepare] ${label} exited ${result.status} — skipping (non-fatal)`);
      return;
    }
    process.exit(result.status ?? 1);
  }
}

console.log(`[prepare] ${plan.reason}`);
if (plan.buildFrontend) {
  run('build frontend', 'npm', ['run', 'build']);
}

// Always: cheap CLI compile. husky is best-effort — it's a devDependency, so it
// won't exist in a consumer's production-deps git-dep install, and it no-ops
// outside a git repo. Failure there must not break the install.
run('build CLI', 'npm', ['run', 'build:cli']);
run('husky', 'npx', ['husky'], { optional: true });
