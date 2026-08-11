// The contract a published vibedocs tarball must satisfy, and the pure check
// that enforces it. No side effects on import — see tests/tarball-contract.test.ts.
//
// Why this is its own module: the same contract is asserted from two places
// that must not drift.
//
//   1. `npm run pack:inspect` — the local pre-flight before cutting a release.
//   2. the `publish-rehearsal` CI job — the same assertion on every push.
//
// Both pack for real (no `--ignore-scripts`, no prior build step) so the
// `prepare` lifecycle runs exactly as it would during `npm publish`. That is
// the whole point: the failure this guards against lives in npm's lifecycle,
// not in our code. `tests/package-shape.test.ts` is deliberately NOT folded in
// here — it packs with `--ignore-scripts` to assert what is *excluded* from a
// locally-built tree, which is a different question with a different setup.

/**
 * Entries that must appear verbatim in `tar -tzf` output. npm prefixes every
 * path in a tarball with `package/`.
 */
export const REQUIRED_TARBALL_ENTRIES = [
  'package/dist-cli/cli/index.js',
  'package/dist-cli/server.js',
  'package/frontend/dist/index.html',
  'package/README.md',
  'package/LICENSE',
];

/** Prefix under which the built SPA bundle lands. */
export const FRONTEND_ASSET_PREFIX = 'package/frontend/dist/assets/';

/**
 * Floor for the number of files under {@link FRONTEND_ASSET_PREFIX}.
 *
 * A real build currently emits ~66. The floor is deliberately far below that:
 * this exists to catch "the Vite build did not run at all" (0 files) or a
 * half-run build, not to pin an exact bundle shape that legitimately drifts as
 * chunks split and merge.
 */
export const MIN_FRONTEND_ASSETS = 5;

/**
 * Check a tarball listing against the contract.
 *
 * Pure: takes the listing, returns a verdict. Collects *every* violation rather
 * than short-circuiting, so one run tells you everything that is wrong.
 *
 * @param {string[]} entries  Lines of `tar -tzf` output.
 * @returns {{ ok: boolean, errors: string[], assetCount: number }}
 */
export function checkTarballContents(entries) {
  const present = new Set(entries.map((entry) => entry.trim()).filter(Boolean));
  const errors = [];

  for (const required of REQUIRED_TARBALL_ENTRIES) {
    if (!present.has(required)) {
      errors.push(`missing from tarball: ${required}`);
    }
  }

  const assetCount = [...present].filter((entry) =>
    entry.startsWith(FRONTEND_ASSET_PREFIX),
  ).length;

  if (assetCount < MIN_FRONTEND_ASSETS) {
    errors.push(
      `frontend/dist/assets/ looks empty (${assetCount} files, expected at least ` +
        `${MIN_FRONTEND_ASSETS}) — the Vite build did not run during pack`,
    );
  }

  return { ok: errors.length === 0, errors, assetCount };
}
