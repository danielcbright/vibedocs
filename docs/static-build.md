# Static-build reference

Detail for `vibedocs build`: hydration policy, the PWA seam, and Pagefind
search. Split out of `CLAUDE.md` on 2026-08-10 — these sections had grown into
release notes (what was built, how it was verified) rather than instructions,
and were roughly a third of that file. CLAUDE.md keeps a pointer; the mechanism
and its rationale live here.

### Static-build hydration policy

`vibedocs build` accepts a `--hydration <full|minimal>` flag (or `hydration: 'full' | 'minimal'` field on `siteConfig`). Resolution order: CLI flag → `siteConfig.hydration` → `'full'` (default).

| Policy | Behaviour |
|---|---|
| `full` (default) | Today's behaviour — copies `frontend/dist/assets/*` into `<out>/assets/` and emits `<script type="module">` so the SPA hydrates on page load. Reader gets search (Ctrl+K), theme toggle, mermaid render, copy-md, mobile drawer, live reload. |
| `minimal` | Skips the SPA bundle copy AND the bootstrap `<script>` tag. Still emits the Vite-generated CSS link (Shiki tokens, prose typography, table styles). When `siteConfig.nav.sections` is set, renders a semantic `<nav aria-label="Main navigation">` with nested `<ul>` server-side; otherwise falls back to the flat-link `data-vd-fallback-nav` list. Ships ~500 KB less JS per page. |

`composePageHtml` is the single seam — both the script-tag and the nav-rendering branch read from `hydration`. `runBuild` resolves the policy once via `resolveHydration(cliFlag, siteConfig?.hydration)` in `src/cli/args.ts` and threads the result through.

End-of-build summary names what was decided:

- `Hydration policy: full (SPA bundle copied — N files, ~XXX KB)` OR
- `Hydration policy: minimal — no SPA bundle (saved ~XXX KB)`

Saved/copied bytes come from a single `sumDirBytes(frontendDist/assets)` walk that runs in both modes, so the numbers match what the copy actually does.

**UX caveats for `minimal` mode** — these are intentional tradeoffs, document them in any consumer-facing README:

- Search dialog (Ctrl+K) — gone, BUT a self-contained Pagefind search box is injected in both modes (issue #56, see "Static-build search" below). The SPA's Ctrl+K palette specifically is full-mode only.
- Theme toggle button — gone. Readers get system-preference theme only (CSS `prefers-color-scheme` still works via the existing theme-var setup)
- Rendered Mermaid diagrams — gone. Raw `<pre>` source visible instead. Server-side Mermaid is a follow-up slice.
- "Copy markdown" button per-page — gone
- Mobile drawer toggle — gone (use plain CSS navigation or no-JS `<details>`)
- WebSocket live-reload — gone (not relevant in production builds anyway)

Pick `minimal` for public docs sites where most readers land on one page and leave. Pick `full` for the live workspace where you want the interactive app.

### Static-build PWA (issue #143)

Every `vibedocs build` output is an installable, offline-capable PWA — in **both** hydration modes. The PWA logic is a separate seam from the live-app PWA (#142): `src/cli/pwa.ts` holds the pure, unit-tested pieces (`tests/cli-pwa.test.ts`), wired into the build by `runBuild` (`src/cli/build.ts`) and `composePageHtml` (`src/cli/template.ts`).

- **Head tags:** `composePageHtml` injects the manifest link + `theme-color` + iOS "Add to Home Screen" meta + favicons in BOTH branches when an `opts.pwa` is supplied (it always is from `runBuild`). The SW registration is a plain `<script src="/sw-register.js">` (NOT `type="module"`) so the minimal-mode "no module script" contract holds — in minimal mode this is the only JS the page ships.
- **Emitted files** (per build, into `<out>/`): `manifest.webmanifest`, `sw.js`, `sw-register.js`, and the shared #142 icon set (`PWA_ICON_FILES` — icons + favicons copied from `frontendDist`, where Vite mirrors `frontend/public/*`). Icons are NOT regenerated — they're the #142 assets.
- **Static service worker** (`staticServiceWorkerSource(version)`): self-contained, no `/api/` routing (static sites have no API). Precaches the shell on install; on fetch, `/assets/*` is cache-first (immutable hashed bundles), everything else is network-first and cached so visited pages read offline; navigations fall back to the cached root shell. The cache name is `vibedocs-static-<version>` where `<version>` is a content hash (bundle entry + stylesheet + icon list) computed in `runBuild` — a rebuild rotates it and the `activate` handler purges stale caches.
- **Config-derived manifest** (`buildManifest(siteConfig, projectName)`): `name`/`short_name`/`description` come from `siteConfig` (else the project name); `theme_color` from `siteConfig.theme.tokens['--primary']` when it's a hex color (else the #142 default `#8852e0`). `resolveThemeColor` only honours hex tokens — Tailwind `oklch(...)`/HSL-triple tokens aren't valid `theme_color`s.

Verified in a real browser against local builds of both modes (offline reading confirmed by killing the static server and reloading): manifest loads, SW registers + controls the page, and previously-visited pages render with the server down.

### Static-build search (Pagefind, issue #56)

Every `vibedocs build` output gets self-hosted full-text search via [Pagefind](https://pagefind.app), on by default in **both** hydration modes. Separate seam from the live SPA's Ctrl+K search-dialog (which hits the Hono `/api/search` index) — the static search is a stand-alone Pagefind UI widget that does NOT depend on the React bundle, so it works in `minimal` mode where no SPA ships.

- **Pure pieces** (`src/cli/pagefind.ts`, tested in `tests/cli-pagefind.test.ts`): `renderPagefindHeadTags()` (the `/pagefind/pagefind-ui.css` link), `renderPagefindUiTags()` (the `<div id="vd-search">` mount + `/pagefind/pagefind-ui.js` script + a plain — non-module — `new PagefindUI(...)` bootstrap), and `resolveSearchEnabled(siteConfig.search)` (defaults `true`).
- **Indexer** (`indexWithPagefind(outDir)`): uses Pagefind's programmatic Node API (`createIndex` → `addDirectory` → `writeFiles`) to index the built HTML in place, emitting the `/pagefind/` bundle (WASM index + UI assets). Runs LAST in `runBuild`, after every page and raw-md mirror is on disk.
- **`pagefind` is an `optionalDependency`**, not a devDependency — it pulls a ~57 MB platform binary, and as a devDependency npm consumers never received it, so `npx vibedocs build` failed outright for them. Because optional installs can be skipped (and Pagefind doesn't publish a binary for every platform), presence is never assumed: `isPagefindAvailable()` probes by import and `resolveSearchEnabled(siteConfigSearch, pagefindAvailable)` folds that into one decision that drives BOTH the per-page markup and the indexing step. They must not diverge — emitting the widget without writing the bundle publishes pages that 404 on `/pagefind/pagefind-ui.{css,js}`. Absent Pagefind: warn on stderr, emit no search markup, exit 0.
- **Wiring:** `composePageHtml` injects the head + body tags in both branches when `opts.search` is truthy (`runBuild` threads `resolveSearchEnabled(siteConfig?.search)`). The real indexer is passed from the CLI dispatcher (`src/cli/index.ts`) as `pagefindIndexer`; `runBuild`'s own unit tests omit it so they never spawn the binary (the search markup is pure and still asserted). Disable per-site with `search: false` in `.vibedocs.config.ts` — skips both the indexing step and the per-page UI.

Verified in a real browser against a 3-page local build (served on a non-default port): the search box renders in full mode alongside the SPA, a query returns highlighted results, sub-page hits (`docs/install/`) route correctly, and clicking a result navigates. Screenshot captured during the slice.
