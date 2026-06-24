#!/usr/bin/env node
// Runs on every `npm install` via the package.json "prepare" lifecycle script.
//
// Why this exists: `prepare` is the only lifecycle hook npm fires when a package
// is installed as a git dependency (`npm install github:danielcbright/vibedocs#…`),
// so the published-package path genuinely needs it to build `frontend/dist/`. But
// `prepare` ALSO fires on every self-install in the source repo (e.g. a dev running
// `npm install some-new-dep`), and the ~12s Vite build there is pure waste.
//
// The discriminator: npm sets INIT_CWD to the directory where the user invoked
// `npm install`. On a self-install that's the package dir (this repo's root). On a
// git-dep install it's the *consumer's* repo root, while this code runs from the
// package dir inside the consumer's node_modules — so the two paths differ.
//
//   INIT_CWD === packageDir  -> local self-install   -> skip the heavy frontend build
//   INIT_CWD !== packageDir  -> consumer git-dep install -> build frontend/dist/
//
// In both cases we still run `build:cli` (cheap tsc) and `husky` (so dev hooks and
// the consumer CLI both work).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : null;
const isLocalDevInstall = initCwd !== null && initCwd === packageDir;

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

if (isLocalDevInstall) {
  console.log(
    `[prepare] local dev self-install detected (INIT_CWD === package dir) — skipping frontend build`,
  );
} else {
  console.log(
    `[prepare] consumer/git-dep install (INIT_CWD=${initCwd ?? 'unset'}) — building frontend/dist/`,
  );
  run('build frontend', 'npm', ['run', 'build']);
}

// Always: cheap CLI compile. husky is best-effort — it's a devDependency, so it
// won't exist in a consumer's production-deps git-dep install, and it no-ops
// outside a git repo. Failure there must not break the install.
run('build CLI', 'npm', ['run', 'build:cli']);
run('husky', 'npx', ['husky'], { optional: true });
