// Pure decision logic for the `prepare` lifecycle script. Kept in its own
// module (no side effects on import) so it can be unit-tested without
// triggering a real Vite build — see tests/prepare-plan.test.ts.

/**
 * npm invocations that produce a tarball. `prepare` fires for these, and for
 * these the frontend bundle MUST be built: `files:` ships `frontend/dist/**`,
 * and the published package has no other chance to produce it (npm does not
 * run `prepare` when installing from the registry).
 */
const PACKING_COMMANDS = new Set(['publish', 'pack']);

/**
 * Decide whether `prepare` should run the (~13s) Vite frontend build.
 *
 * Two independent signals, in priority order:
 *
 * 1. `npmCommand` — set by npm to the subcommand in flight. When it's
 *    `publish`/`pack` we are producing a tarball and MUST build, regardless of
 *    where the user stood when they typed it.
 * 2. `initCwd` vs `packageDir` — npm sets INIT_CWD to the directory the user
 *    invoked npm from. On a self-install in the source repo they match; on a
 *    consumer git-dep install this code runs from the package dir inside the
 *    consumer's node_modules while INIT_CWD is the consumer's root, so they
 *    differ.
 *
 * Signal 2 alone was the original discriminator, and it silently misfires on
 * publish: `npm publish` is run from the package root, so INIT_CWD ===
 * packageDir and the check concluded "local dev self-install, skip the build".
 * A publish from a clean checkout therefore produced a tarball containing zero
 * frontend assets — an installed `vibedocs serve` with no SPA to serve. Signal 1
 * exists to close exactly that hole, which is why it is checked first.
 *
 * @param {object} env
 * @param {string|null} env.initCwd     Resolved INIT_CWD, or null when unset.
 * @param {string} env.packageDir       Resolved package root.
 * @param {string|undefined} env.npmCommand  npm's `npm_command` env var.
 * @returns {{ buildFrontend: boolean, reason: string }}
 */
/**
 * `npm_config_*` env vars npm exports that must NOT be inherited by a child
 * `npm` process.
 *
 * npm re-exports every config value it resolved into the environment, and a
 * child npm reads them straight back in. That is deliberate and mostly correct
 * — registry, proxy, loglevel and friends should propagate down a build. But
 * `--dry-run` is a statement about the *one command the user typed*, not a mode
 * the whole process tree should adopt.
 */
const NON_INHERITABLE_NPM_CONFIG = ['npm_config_dry_run'];

/**
 * Copy of `env` safe to hand to a child `npm` invocation.
 *
 * Concretely, this is what makes `npm publish --dry-run` usable as a release
 * pre-flight here. Without it, `npm_config_dry_run=true` reaches the nested
 * `cd frontend && npm install` inside `npm run build`; that install writes
 * nothing while still reporting `added N packages`, and the `vite build`
 * immediately after it fails with `Cannot find package '@vitejs/plugin-react'`.
 * The error names Vite, so it reads as a broken `frontend/vite.config.ts` and
 * sends you debugging a file that is fine — the actual tell is that
 * `frontend/node_modules` is absent afterwards.
 *
 * Scrubbing at this boundary is enough for the whole subtree: npm only
 * re-exports what it resolved, so once `prepare` drops the variable, neither
 * `npm run build` nor the `npm install` beneath it sees it again.
 *
 * Note this does not weaken `--dry-run`. npm runs lifecycle scripts for real
 * during a dry-run publish by design — it is the upload that is skipped — so
 * building the frontend for real is exactly what makes the reported file list
 * trustworthy.
 *
 * @param {Record<string, string|undefined>} env  Environment to derive from.
 * @returns {Record<string, string|undefined>}    New env; `env` is not mutated.
 */
export function envForChildNpm(env) {
  const childEnv = { ...env };
  for (const key of NON_INHERITABLE_NPM_CONFIG) {
    delete childEnv[key];
  }
  return childEnv;
}

export function planPrepare({ initCwd, packageDir, npmCommand }) {
  if (npmCommand && PACKING_COMMANDS.has(npmCommand)) {
    return {
      buildFrontend: true,
      reason: `npm ${npmCommand} — building frontend/dist/ so the tarball ships it`,
    };
  }

  if (initCwd !== null && initCwd === packageDir) {
    return {
      buildFrontend: false,
      reason: 'local dev self-install detected (INIT_CWD === package dir) — skipping frontend build',
    };
  }

  return {
    buildFrontend: true,
    reason: `consumer/git-dep install (INIT_CWD=${initCwd ?? 'unset'}) — building frontend/dist/`,
  };
}
