# Changelog

All notable changes to VibeDocs are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version stays below 1.0.0, the CLI flags and `SiteConfig` shape may
still change in a minor release.

## [0.4.0] — 2026-08-09

**The first release published to npm.** `npx vibedocs serve` and
`npx vibedocs build` now work without cloning the repo.

### Added

- **npm distribution.** The package is published as [`vibedocs`](https://www.npmjs.com/package/vibedocs);
  `npx vibedocs serve --root ./projects` runs the live browser and
  `npx vibedocs build --project <name> --out ./site` renders a static site.
- **macOS support, tested.** CI now runs the full build, typecheck and both
  test suites on `macos-latest` alongside `ubuntu-latest`. Linux and macOS are
  the supported platforms; Windows is deferred.
- **Windows notice.** Running the CLI on an untested platform prints a one-line
  notice pointing at the issue tracker. Installation is not blocked — Windows is
  unverified, not known-broken.
- **Publish-rehearsal CI job.** Packs the tarball from a clean checkout with the
  real npm lifecycle (no pre-build, no `--ignore-scripts`), asserts the runtime
  surface is present, then installs the tarball and runs the CLI.
- **`CHANGELOG.md`** (this file) and a **Supported platforms** table in the README.

### Fixed

- **Publishing shipped a tarball with no frontend.** `scripts/prepare.mjs`
  decided whether to run the Vite build by comparing `INIT_CWD` to the package
  directory — a check that correctly skips the ~13s build on a local dev
  self-install, but which `npm publish` also satisfies, because publishing is
  done from the package root. The result was a published package containing zero
  frontend assets: `vibedocs serve` would boot with no SPA to serve. The decision
  now also consults `npm_command` and always builds for `publish`/`pack`. Neither
  existing gate could catch this — CI built `frontend/dist` explicitly before
  testing, and `tests/package-shape.test.ts` packs with `--ignore-scripts` — so
  the fix ships with both a unit test (`tests/prepare-plan.test.ts`) and the
  publish-rehearsal CI job above.
- **The published `bin/vibedocs` was dead on arrival.** The dev entrypoint
  re-execs `src/cli/index.ts` through tsx, but `src/` is deliberately not packed,
  so the shipped copy could only throw `ERR_MODULE_NOT_FOUND`. Dropped from
  `files:`; consumers reach the CLI through the `bin` field, which points at the
  compiled `dist-cli/cli/index.js`.

### Security

- `js-yaml` → `4.3.1`, clearing [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)
  (quadratic CPU consumption in `!!omap` resolution). Stays on the 4.x line the
  custom gray-matter engine depends on — 4.3.1 is the backported fix.
- `hono` → `4.13.1`, clearing four advisories including
  [GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r)
  (`memo()` cross-user data disclosure).
- `mermaid` → `11.16.1`, clearing five advisories (prototype pollution in the
  configuration and architecture-diagram APIs, CSS injection, and two DoS
  paths). This one reaches readers: mermaid is bundled into `frontend/dist`,
  which ships in the tarball.
- `nanoid` → `3.3.17` (dev-only, via vite/postcss).

`npm audit` reports zero advisories across the root and frontend trees, in both
production and development dependency sets.

## [0.3.0] — 2026-07-28

### Added

- `vibedocs serve` — run the live documentation browser from the CLI, not just
  static builds. Re-execs the server as a child process so `--root` is applied
  before `discovery.ts` snapshots the environment.
- Consolidated mobile project switcher in the header.

### Fixed

- Graceful degradation when the optional `pagefind` binary is absent: warn on
  stderr, emit no search markup, exit 0.
- Project tiles now scroll on the mobile home page; the project switcher no
  longer overlaps the search and theme controls.
- `https:` images allowed in the CSP so README badges and screenshots render.

### Changed

- `pagefind` moved from a devDependency to an `optionalDependency` — as a
  devDependency it never reached npm consumers, so `npx vibedocs build` failed
  outright for them.

## [0.2.0] — 2026-05-30

### Added

- Static-site generation: `vibedocs build` with SEO meta, `sitemap.xml`,
  `robots.txt`, `llms.txt`, raw `.md.txt` companions, and an Edit-on-GitHub
  footer link.
- `--hydration minimal` to ship ~500 KB less JS per page.
- Installable, offline-capable PWA output in both hydration modes.
- Self-hosted static full-text search via Pagefind.
- Bearer-token-gated upload endpoint with a read-only deployment mode.

### Changed

- Architecture audit: AppState consolidation, ports/adapters split, and a
  single URL Rewriter pass shared by both render modes.

[0.4.0]: https://github.com/danielcbright/vibedocs/releases/tag/v0.4.0
[0.3.0]: https://github.com/danielcbright/vibedocs/releases/tag/v0.3.0
[0.2.0]: https://github.com/danielcbright/vibedocs/releases/tag/v0.2.0
