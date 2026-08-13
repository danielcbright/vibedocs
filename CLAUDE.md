# CLAUDE.md - VibeDocs

## Project Overview

VibeDocs — self-hosted markdown documentation browser **and** static-site generator. `vibedocs serve` runs the live app; `vibedocs build` renders a publishable static site. Hono backend + React frontend that auto-discovers markdown files across project directories and renders them with rich formatting.

**Port:** 8080 (configurable via `VIBEDOCS_PORT` or `PORT`)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VIBEDOCS_ROOT` | `process.cwd()` | Root directory to scan for project folders |
| `VIBEDOCS_PORT` or `PORT` | `8080` | Server port |
| `VIBEDOCS_WS_ALLOWED_ORIGINS` | _(unset)_ | Comma-separated extra Origin allowlist for the WebSocket handshake. Defaults always include `http://localhost:8080`, `http://localhost:5173`, `http://localhost:${PORT}` and the matching `http://127.0.0.1:` forms. Add tailnet/public hostnames here (e.g. `http://vibedocs.tailnet:8080`) when exposing vibedocs beyond localhost. |
| `VIBEDOCS_WS_ALLOW_NO_ORIGIN` | `false` | When `true`, accept WS handshakes with no `Origin` header (non-browser clients like `wscat`). Default denies them so the threat model stays browser-driven CSWSH. |
| `VIBEDOCS_UPLOAD_TOKEN` | _(unset)_ | Shared-secret bearer token gating `POST /api/upload/*`. When unset, the upload endpoint returns 404 (safe by default — uploads disabled). When set, requests must send `Authorization: Bearer <token>`. |
| `VIBEDOCS_READ_ONLY` | `false` | When truthy (`true`/`1`/`yes`/`on`), `POST /api/upload/*` returns 404 unconditionally — even with a valid token. Frontend upload UI is hidden. Read-only takes precedence over the token gate. |
| `VIBEDOCS_UPLOAD_MAX_BYTES` | `10485760` (10 MB) | Per-file upload size cap. Files exceeding this return 413. |
| `VIBEDOCS_RUNS_ENABLED` | `false` | Master switch for the Agent Runs viewer. When falsy every `/api/runs*` route 404s and no Runs affordance renders. See [`docs/agent-runs.md`](docs/agent-runs.md). |
| `VIBEDOCS_RUNS_DIR` | `~/.vibedocs/runs` | Agent-run storage root, one directory per run. |
| `VIBEDOCS_RUNS_TOKEN` | _(unset)_ | Bearer token gating agent-run **ingest** writes. Unset → ingest 404s (feature not fingerprintable). |
| `VIBEDOCS_RUNS_TOKEN_FILE` | _(unset)_ | Path to a file holding that token. Prefer this under any process manager: a launchd plist or systemd unit is typically world-readable (0644), so a token embedded in one is readable by every local user, while the file can be 0600. The direct variable wins if both are set; a missing or unreadable file yields no token, which disables ingest — failing closed. |

### Upload deployment modes

| Mode | `VIBEDOCS_UPLOAD_TOKEN` | `VIBEDOCS_READ_ONLY` | Result |
|---|---|---|---|
| Local dev (default) | unset | unset | `POST /api/upload/*` → 404. `/api/config` → `{ uploadEnabled: false }`. Upload UI hidden. |
| Trusted team | set | unset | Upload requires `Authorization: Bearer <token>`. `/api/config` → `{ uploadEnabled: true }`. Upload UI visible. |
| Public read-only | any | `true` | `POST /api/upload/*` → 404 (endpoint pretends not to exist). `/api/config` → `{ uploadEnabled: false }`. Upload UI hidden. |

Upload route gate ordering (defined in `src/upload-pipeline.ts` `UPLOAD_GATES`):

1. **Read-only check** (`readOnlyGate`, phase `auth`) → 404 (precedence over everything)
2. **No token configured** (`tokenConfiguredGate`, phase `auth`) → 404 (don't reveal the endpoint exists)
3. **Token mismatch** (`authorizedGate`, phase `auth`) → 401
4. **Denied extension** (`extensionGate`, phase `content`) → 400 (allowlist: `.md .markdown .png .jpg .jpeg .gif .webp .pdf .txt`; deny: `.html .htm .xhtml .svg .js .mjs .json .css .wasm`)
5. **Per-file size cap exceeded** (`sizeGate`, phase `content`) → 413
6. **Success** → 200 `{ data: WriteResult[] }`

The ordering above lives in the `UPLOAD_GATES` array in `src/upload-pipeline.ts` — the array order IS the security ordering. Two structural tests in `tests/upload-pipeline.test.ts` enforce it: one asserts the exact `name` sequence; the other asserts every `auth`-phase gate precedes every `content`-phase gate. Reordering either invariant in source breaks a test. The route handler (`src/upload-route.ts`) runs `runPipelinePhase('auth', …)` before parsing the request body (so unauthenticated requests don't pay for multipart parsing), then `runPipelinePhase('content', …)` after.

### Static-build behaviour — see `docs/static-build.md`

`vibedocs build` output is governed by three seams, documented in full at
[`docs/static-build.md`](docs/static-build.md):

| Seam | One-line contract |
|---|---|
| **Hydration** (`--hydration full\|minimal`) | `full` ships the SPA bundle; `minimal` ships CSS + server-rendered nav and ~500 KB less JS. `composePageHtml` is the only branch point. |
| **PWA** (`src/cli/pwa.ts`) | Every build is installable and offline-capable in BOTH modes. SW registration is a plain script, never `type="module"`, or minimal mode's no-module-script contract breaks. |
| **Search** (Pagefind, `src/cli/pagefind.ts`) | On by default in both modes, independent of the React bundle. `pagefind` is an **optionalDependency**; `resolveSearchEnabled` must drive the per-page markup and the indexing step together, or pages 404 on `/pagefind/*`. |

### Agent Runs — see `docs/agent-runs.md`

A live viewer for headless coding-agent runs, off unless `VIBEDOCS_RUNS_ENABLED`
is set. Three seams: **ingest** (`src/agent-runs/`), **format adapters**
(`src/agent-runs/formats/`), **view** (`frontend/src/agent-runs/`).

Four things that will bite if you touch this code:

1. **Writes split by threat model, not by method.** Ingest (`POST /api/runs`,
   `POST …/events`, `POST …/ack`) takes a bearer token. Control (`PATCH
   /api/runs/:id`, `POST …/commands`) takes **either** the bearer token **or** a
   same-origin `Origin` header, because two callers need it and neither can show
   the other's proof: the browser holds no secret (serving it the ingest token
   would put a shared secret in devtools) so it proves same-origin, while a
   machine client reporting its own lifecycle has no origin and would otherwise
   have to fake one. Failing both is 403; a disabled feature is 404 and is
   checked first. `src/agent-runs/auth.ts` is the single seam — do NOT compose the
   OR in `routes.ts`, or the policy ends up in two places.
2. **`events.ndjson` is a log of records, not events.** An append-only file
   cannot rewrite a tool call on completion, so `started` appends and
   `completed` patches. Paging is therefore by **record position**
   (`?fromRec=`), never by event seq — a patch can target an event from an
   earlier page. `applyRecords()` in `src/shared/agent-run-types.ts` is the one
   fold, used by both sides.
3. **Route order is load-bearing, and the failure looks like success.** All
   `/api/runs*` routes must register before `registerStaticRoutes`, and
   `/api/runs/config` before `/api/runs/:id`. The SPA fallback answers *any*
   unmatched path with `200 text/html`, so a misordered route returns a success
   status with an HTML body and a client checking `res.ok` reports a push that
   never happened. The route tests assert `content-type`, not just a 2xx.
4. **A clean `tsc -p tsconfig.cli.json` does not mean your file was checked.**
   That project reaches files by following imports from `src/server.ts`. Confirm
   with `npx tsc -p tsconfig.cli.json --listFiles | grep -c 'src/agent-runs/'`
   (currently >0 because the routes are wired in). Note also that vitest runs
   through esbuild, so the suite stays green while types are broken — run both.

## Tech Stack

- **Backend:** Node.js + Hono 4 + TypeScript
- **Frontend:** React 19 + Vite + shadcn/ui + Tailwind CSS v4
- **Markdown:** unified/remark/rehype + Shiki (syntax highlighting) + Mermaid (diagrams)
- **Live Reload:** chokidar (file watching) + WebSocket (ws)

## Project Structure

```
src/                    # Backend (Hono server)
  server.ts             # HTTP server, route wiring, WebSocket, SPA fallback
  server-routes.ts      # Route handlers extracted for testability
  upload-route.ts       # POST /api/upload/* + GET /api/config (registerUploadRoute, registerConfigRoute)
  upload-pipeline.ts    # Ordered UPLOAD_GATES + runPipelinePhase('auth'|'content', ctx); enforces gate order via array structure
  upload-auth.ts        # parseUploadAuthConfig, checkUploadAuth, checkExtensionAllowed (pure policy fns)
  discovery.ts          # Project/file tree discovery (all file types, isAsset flag)
  excluded-paths.ts     # Single source of truth for EXCLUDED_DIRS (shared by discovery/search/path-resolver)
  render.ts             # renderProject orchestration: per-project walk, gray-matter frontmatter parse (custom js-yaml@4 engine — see #150), missingRefs detection, RenderResult assembly
  cli/seo.ts            # resolvePageSeo — pure per-page SEO meta resolution (title/description/og/twitter/canonical/noindex) from frontmatter + siteConfig
  markdown-processor.ts # createMarkdownProcessor(opts) factory — unified() pipeline (remark/rehype/shiki/mermaid/sanitize)
  url-rewriter.ts       # rehypeRewriteUrls + RewriteOptions + RenderMode — pure URL transformation by mode
  reference-collector.ts # createReferenceCollector — captures resolved asset refs during build for missing-ref detection
  search.ts             # In-memory full-text search index (factory, versioned). Entries keyed by absolute path; rebuild() full walk + updateFile()/removeFile() incremental patches, all serialised. resolveIndexKey is the SSOT for index scope.
  coalescing-runner.ts  # createCoalescingRunner — debounce + single-flight. Guards the full index re-walk; see the OOM note under Gotchas.
  upload.ts             # safeWriteFile(targetDir: SafePath, ...): conflict renaming + safe writes
  path-resolver.ts      # PathResolver: validates project+path → SafePath; throws VibedocsError
  errors.ts             # VibedocsError taxonomy + registerErrorHandler (single HTTP translation point)
  shared/               # Canonical home for types shared between backend (src/) and frontend (frontend/src/) — import via the `@shared/*` alias from the frontend
    ws-messages.ts      # Typed WS message envelope
    site-config-types.ts # SiteConfig + RenderMode + related (shared so frontend can render config-driven UI)
frontend/               # Frontend (Vite React app)
  src/
    App.tsx             # Root layout: mobile (hamburger drawer + bottom-sheet TOC) / desktop (3-panel resizable). navigateSmart resolves folder/empty paths to first markdown file.
    components/         # app-sidebar, doc-content, breadcrumb-nav, toc-panel, mobile-toc, search-dialog, theme-toggle, connection-status
    components/ui/      # shadcn/ui primitives (auto-generated)
    hooks/              # use-projects, use-document, use-websocket, use-search, use-mobile, use-raw-document
    lib/utils.ts        # cn() utility
    lib/mermaid-loader.ts / mermaid-shim.ts / mermaid-render.ts  # Lazy mermaid renderer (prod-chunk-shape discipline)
    index.css           # Tailwind + theme vars + prose styles + scroll-shadow + `@media (hover: none)` tap-target utilities
  vite.config.ts        # Vite config with API proxy
  components.json       # shadcn/ui config
tests/                  # Backend tests (vitest) — includes mermaid-bundle.test.ts which inspects dist artifacts
vitest.config.ts        # Vitest config
systemd/
  vibedocs.service      # systemd user service unit file (template)
scripts/
  setup-service.sh      # One-time service installation
  promote.sh            # Build → validate → restart promotion script
  prepare.mjs           # `prepare` lifecycle shell (side effects only)
  prepare-plan.mjs      # Pure: planPrepare (build-or-skip) + envForChildNpm (dry-run scrub)
  tarball-contract.mjs  # Pure: what a published tarball must contain (SSOT for pack:inspect + CI)
  pack-inspect.mjs      # Real pack + assert the contract
  release-check.mjs     # Pure checkReleaseReadiness + git/registry state gathering
Makefile                # Thin front door; every target delegates to an npm script
docs/
  architecture.md       # Full architecture documentation
```

## Commands

```bash
npm run dev           # Start both backend (8080) + Vite dev server (5173)
npm run dev:server    # Backend only
npm run dev:frontend  # Vite dev server only
npm run build         # Build frontend to frontend/dist/
npm start             # Production: serve everything from Hono
npm test              # Run tests (vitest)
npm run test:watch    # Run tests in watch mode
npm run typecheck     # Backend/CLI: tsc -p tsconfig.cli.json --noEmit
npm run typecheck:frontend  # Frontend: tsc -b (needs frontend deps installed)
npm run verify        # Full gate, in CI's order: build:cli + typecheck + build + typecheck:frontend + both suites
npm run pack:inspect  # Real pack; asserts the tarball ships the runtime surface
npm run release:check # Pre-tag guard (clean tree, pushed, version free, tag free)
```

**`npm run verify` is the "am I done?" command.** It runs the same steps in the
same order as the `test` CI job, so a green `verify` means CI will be green for
the same reasons.

**Two typecheck projects, and neither covers the other.** `typecheck` reaches
files by following imports from `src/server.ts`; the frontend has its own
`tsconfig` graph. Two traps live in the frontend one:

- **It must be `tsc -b`.** `frontend/tsconfig.json` is solution-style (`files: []`
  plus project references), so `tsc --noEmit` there checks *nothing* and exits 0.
  That is how the frontend went entirely unchecked while looking gated (#190).
- **`vite build` is not a typecheck.** Vite strips types through esbuild without
  checking them, so a build stays green over broken types — exactly as vitest does
  for the suites.

It runs after `build` in both `verify` and CI, because it needs the frontend deps
that step installs. It is also what enforces the WS protocol's exhaustiveness
guarantee: `src/shared/ws-messages.ts` promises a new variant produces a compile
error at every unhandled call-site, and `handleWsMessage`'s `never` check delivers
that — but only when something actually compiles.

There is also a `Makefile` — a **thin front door, not a build system**. Every
target is one line delegating to an npm script (`make help` lists them). npm
scripts stay canonical because npm's own lifecycle invokes them: `npm publish`
runs `prepare`, and that is what builds `frontend/dist/` into the tarball. Make
is never in that path and cannot be. If a Make target ever grows real logic,
that logic belongs in package.json or `scripts/` instead — otherwise the two
surfaces drift and the npm one is the one that governs publishing.

## Gotchas

- **Never drive the full search re-walk straight from an event handler.** `rebuild()` holds a second complete copy of every indexed file's contents while it builds — measured at +82.5 MB and 3.2 s against 6864 markdown files / 41 MB — so one walk per file-system event means one copy per event. That is how the LaunchAgent used to die: `FATAL ERROR: Reached heap limit` at ~4 GB, restarted by `KeepAlive` so it looked healthy while `launchctl list` showed `last_exit = -6`. The logs recorded 3197 markdown events firing a rebuild against only 67 completions; one boot took a worktree sweep of 2162 events and died before a single walk finished. Note it needs no burst — a walk takes 3.2 s, so arrivals above one per 3.2 s accumulate. Volume was never the problem (one index is 86 MB, 2% of the ceiling) and there is no leak (five sequential rebuilds sit flat at 85.2 MB); **concurrency** is what bounds memory. Everything that triggers a walk goes through the `CoalescingRunner` in `src/coalescing-runner.ts` (debounce + at most one in flight + exactly one trailing run), and prefer `updateFile`/`removeFile` where a single file is known. Raising `--max-old-space-size` is not a fix — 2162 concurrent walks would need ~185 GB.
- **`promote.sh` prunes devDeps.** It runs `npm install --omit=dev`, so after any deploy `vitest` and `tsc` are gone from the main tree. The failure is worse than "command not found": `npx tsc` falls through to an unrelated registry package and prints **"This is not the tsc command you are looking for"** (exit 1), which reads like a broken tsconfig rather than a missing dependency. Either `npm install` first, or do the work in a separate worktree — preferable anyway, because the live systemd service runs out of this directory's `node_modules` and reinstalling under it can disturb a service you're using.
- **Typecheck through the CLI project, not the root.** CI runs `npx tsc -p tsconfig.cli.json --noEmit`. A bare `npx tsc --noEmit` at the root surfaces a *different*, pre-existing error and will send you chasing the wrong thing.
- **Sweep `.claude/worktrees/`.** Agent worktrees are created locked, so `git worktree prune` skips them and they never get reaped. They reached 43 worktrees / 18 GB once. A locked worktree also pins its branch, so `git branch -D` fails until the worktree is removed.
- **The live service serves from this checkout.** `frontend/dist/` changes appear on reload, but backend changes need `systemctl --user restart vibedocs`. `promote.sh` handles both, and its restart step is the part that fails when run without access to the user systemd bus.
- **`npm_config_dry_run` must never reach a child npm — `prepare` scrubs it, don't undo that.** npm re-exports every resolved config value as an `npm_config_*` env var and child npm processes read them back in. For `--dry-run` that is poison: it reaches the `cd frontend && npm install` nested inside `npm run build`, which then installs *nothing* while still printing `added N packages`, and Vite dies on `Cannot find package '@vitejs/plugin-react'` — an error that reads like a broken `frontend/vite.config.ts` and sends you debugging a file that is fine. The tell is `frontend/node_modules` being absent afterwards. `envForChildNpm` in `scripts/prepare-plan.mjs` drops the variable at the `prepare` boundary, which is enough for the whole subtree; `tests/prepare-plan.test.ts` guards it. **`npm publish --dry-run` is therefore a valid pre-flight again** (verified from a clean clone: exit 0, 123 files, 66 frontend assets). A real `npm pack` remains the stronger check, since it is what the `publish-rehearsal` CI job runs and it leaves a tarball you can inspect with `tar -tzf`. To publish the audited bytes rather than a fresh unverified build, pack first and publish the tarball path: `npm publish ./vibedocs-<v>.tgz`.
- **`prepare` decides on `npm_command`, not just `INIT_CWD`.** `scripts/prepare-plan.mjs` owns that decision and is unit-tested (`tests/prepare-plan.test.ts`). `npm publish` runs from the package root, so an `INIT_CWD`-only check is indistinguishable from a dev self-install — that misfire nearly shipped a tarball with zero frontend assets. If you touch the prepare logic, the `publish-rehearsal` CI job is the gate that matters; keep it free of any pre-build step or it silently stops testing anything.

## CLI surface (`src/cli/index.ts` USAGE)

```bash
vibedocs serve [--root <dir>] [--port <n>]     # live documentation browser
vibedocs build --project <name> --out <dir>    # static site
vibedocs build --project <name> --serve        # build, then preview via sirv
```

`vibedocs serve` (`src/cli/serve-live.ts` `runLiveServer`) exists so the published npm package can run the live app, not just generate static sites. It **re-execs `dist-cli/server.js` as a child process** rather than setting env vars and `await import`-ing it. That is deliberate and load-bearing: `discovery.ts` snapshots `PROJECTS_DIR` from the environment at module-load time, and the dispatcher statically imports `build.js` → `discovery.js`, so by the time `runLiveServer` runs the snapshot has already been taken against an unset `VIBEDOCS_ROOT`. An in-process import boots a server that silently ignores `--root` and serves the current directory. The child process gets a fresh module graph with the env already correct, and stays correct regardless of what the dispatcher imports later. `resolveServerEntry()` picks `dist-cli/server.js` (published) or `src/server.ts` + `--import tsx` (dev via `bin/vibedocs`).

Note `runLiveServer` (live app) is distinct from the pre-existing local `runServe` in `src/cli/index.ts`, which shells out to `sirv-cli` to preview an already-built static site.

Adding `src/server.ts` to `tsconfig.cli.json` pulled the whole server into a typechecked project for the first time and surfaced a latent bug in `src/adapters/ws-client-channel.ts`: the `server` cast targeted `net.Server`, i.e. the parameter's own type, so it never bridged to the `http.Server` that `ws` expects. CI had never caught it because CI only typechecks `tsconfig.cli.json`.

## API Routes

- `GET /api/projects` - Project list with file trees (includes `isAsset` flag for non-markdown files)
- `GET /api/render/:project/*` - Render markdown to HTML + TOC
- `GET /api/raw/:project/*` - Raw markdown content
- `GET /api/search?q=` - Full-text search
- `POST /api/upload/:project/*` - Upload files to a project folder (multipart form data). Gated by `VIBEDOCS_UPLOAD_TOKEN` + `VIBEDOCS_READ_ONLY`. See "Upload deployment modes" above.
- `GET /api/file/:project/*` - Serve non-markdown files (images, PDFs, etc.)
- `GET /api/config` - Tiny client config endpoint: `{ uploadEnabled: boolean }`. Frontend uses this to hide upload UI when uploads are disabled or in read-only mode.

## Key Patterns

- **Hash routing:** URLs use `#project/path/to/file.md` format
- **Dual-theme Shiki:** CSS variables (`--shiki-light`/`--shiki-dark`) toggle with `.dark` class
- **Mermaid:** Self-hosted `mermaid` npm dep, lazy-imported via `frontend/src/lib/mermaid-shim.ts` only when a doc contains `.mermaid` divs (zero bundle cost on diagram-free pages). Per-diagram failures degrade to a `<pre>` with a "Diagram failed to render" label. Re-initializes on theme change. `tests/mermaid-bundle.test.ts` inspects dist artifacts to guard against the prod-build chunk-shape regression that motivated this approach.
- **WebSocket messages:** `{ type: 'reload' }` for markdown changes, `{ type: 'refresh-tree' }` for any file add/remove
- **SPA fallback:** In production, all non-API GET requests return `frontend/dist/index.html`
- **Search index:** Full walk on startup and to reconcile directory-level changes; individual file events patch a single entry via `updateFile`/`removeFile`. `resolveIndexKey(rootDir, absPath)` decides scope for BOTH paths, so the walk and the incremental patches cannot disagree about whether a file belongs in the index. Every mutation is serialised on one chain inside the store — a watcher can deliver add-then-unlink for the same path without the caller awaiting between them, and without the queue the slower read could land after the removal and resurrect a deleted file.
- **Path validation:** `src/path-resolver.ts` — `PathResolver` returns a `SafePath` branded type that downstream FS calls require; throws typed `VibedocsError` (traversal / invalid / not-found) on failure. Two instances (`docResolver`, `assetResolver`) configured at server startup.
- **File upload:** `src/upload.ts` `safeWriteFile(targetDir: SafePath, ...)` does filename sanitization via `path.basename()` and conflict auto-renaming (`file-1.ext`, `file-2.ext`, up to 100 suffixes). Path validation happens earlier at the resolver.
- **Upload auth:** `src/upload-auth.ts` exposes pure functions used by `src/upload-pipeline.ts`: `parseUploadAuthConfig(env)` reads `VIBEDOCS_UPLOAD_TOKEN`/`VIBEDOCS_READ_ONLY`/`VIBEDOCS_UPLOAD_MAX_BYTES`; `checkUploadAuth(cfg, authHeader)` returns a discriminated `'read-only' | 'no-token-configured' | 'unauthorized' | 'ok'`; `checkExtensionAllowed(filename)` enforces an allowlist (`.md`, images, `.pdf`, `.txt`) with explicit deny for `.html`/`.svg`/`.js`/etc. Read-only mode hides the endpoint (404) regardless of token; an unset token also returns 404 (not 401) so unauthenticated scanners can't fingerprint the feature. Bearer-token comparison is constant-time (`crypto.timingSafeEqual`).
- **Upload pipeline:** `src/upload-pipeline.ts` composes the auth policy + extension/size checks into a typed, ordered `UPLOAD_GATES` array — each gate is a tagged `UploadGate` with a `phase: 'auth' | 'content'` field. The route handler in `src/upload-route.ts` calls `runPipelinePhase('auth', ctx)` first (no body parse needed) then `runPipelinePhase('content', ctx)` after parsing files. Gate ordering is enforced by code: `tests/upload-pipeline.test.ts` asserts both the exact `UPLOAD_GATES.map(g => g.name)` sequence and the phase invariant (every auth gate precedes every content gate).
- **Mobile tap-targets:** `frontend/src/index.css` `@media (hover: none) and (pointer: coarse)` block exposes `.tap-target` (44×44), `.tap-row` (44px min-height), `.tap-visible-on-touch` (overrides hover-revealed UI), `.tap-active-feedback` (visible :active background). Prefer these on new mobile-facing controls over bespoke responsive sizing.
- **Navigation:** `frontend/src/App.tsx` `navigateSmart(project, path)` — file paths navigate directly; empty/folder paths resolve to the first markdown file under that scope via depth-first tree walk. Used by `DocContent` (so breadcrumb folder/project clicks land on a real doc). Sidebar uses plain `navigate` since its clicks always have full file paths.
- **Discovery:** `buildTree()` includes all file types; non-markdown files get `isAsset: true` flag. Root-level discovery stays markdown-only.
- **File watcher:** Scope is `EXCLUDED_DIRS` + dot-directories, so it declines to watch anything the other three layers would refuse to index or serve (99,335 watched entries → 76,683 on a real set of roots; RSS 210 MB → 149 MB). Two traps live in that predicate, both silent: the default root `~/.vibedocs/roots` is itself a dot-directory, so a naive "ignore any dot segment" rule ignores *everything*; and because roots are **symlinks**, chokidar reports symlink-resolved paths (`/Users/x/Development/…`), so a purely root-relative predicate sees them as outside the root and ignores *nothing* — that mistake grew the watcher to 866,194 entries. `resolveIgnorePrefixes` resolves each root's realpath up front and the dot rule only applies below a known prefix. Also note macOS chokidar is fsevents-backed: it notifies recursively at the OS level and filters by full path, so the predicate must reject a dot-directory **ancestor**, not just the last segment. Markdown file events patch one index entry; directory events schedule a coalesced full re-walk (chokidar does not promise a per-file event for every file in a directory that appears or disappears in one operation, so the walk is the only way to be sure). Non-markdown file events only broadcast `refresh-tree`.
- **Frontmatter + per-page SEO:** `src/render.ts` runs `gray-matter` per page — the parsed YAML lands in `HtmlPage.frontmatter` and the stripped body is what gets rendered (the author's H1 stays untouched; frontmatter `title:` drives `<title>` only — grill decision #18). gray-matter is run with a **custom YAML engine** backed by `js-yaml@4`'s `load` (`parseFrontmatter` passes `{ engines: { yaml: ... } }`); gray-matter's bundled default engine pins the vulnerable `js-yaml@3` (GHSA-h67p-54hq-rp68, quadratic-blowup DoS via merge-key aliases — issue #150). The `overrides` block in `package.json` dedupes gray-matter's transitive `js-yaml` up to `^4.2.0` (the patched line), and the custom engine ensures gray-matter never calls js-yaml@4's removed `safeLoad` stub. Do NOT remove the custom engine without also dropping the override, or the parse will throw at runtime. The DoS is only author-triggerable (doc authors have FS write access already), but the swap keeps `npm audit` clean for release hygiene. `src/cli/seo.ts` `resolvePageSeo({ page, siteConfig, baseUrl })` is the pure resolver: title (frontmatter → first H1 → filename), description (frontmatter → `siteConfig.description`), `og_image` (frontmatter → `siteConfig.seo.ogImage`), canonical (`baseUrl` + clean URL), `twitter:card` (`summary_large_image` when an og:image exists), `twitter:site` (`siteConfig.seo.twitterHandle`), and `noindex` (frontmatter `noindex` OR `draft`). `composePageHtml` emits the tags from the resolved struct (all attribute-escaped — frontmatter is author-controlled). `runBuild` resolves `siteBaseUrl` once and shares it between per-page canonical URLs and the sitemap (#54), so they can't disagree; `noindex` pages get a `<meta name="robots" content="noindex">` AND are dropped from `sitemap.xml`.

## Cutting a release

Releasing is **pushing a `v*` tag**. `.github/workflows/release.yml` does the
rest: it re-runs the gates against the tag, asserts the tag matches
`package.json`'s version, inspects the tarball, publishes, and opens a GitHub
release with generated notes.

```bash
npm version <patch|minor|major>   # bumps package.json, commits, creates the tag
npm run release:check             # clean tree? version free? tag points at HEAD?
npm run verify                    # both typechecks + both suites
npm run pack:inspect              # tarball actually ships the runtime surface
git push origin main --follow-tags
```

`release:check` answers one question — *if I push HEAD and this tag right now,
will the release job succeed?* It is designed to run **after** `npm version`, so
an unpushed commit and a just-created tag are warnings, not failures. It blocks
on a dirty tree, an already-published version, being behind origin, and the
genuinely dangerous case: a `v*` tag that exists but points somewhere other than
HEAD (CI checks out the tag, so it would publish a commit you are not looking
at). A guard that blocks correct work gets deleted rather than fixed, which is
why the warning/blocker split is drawn exactly there.

**Publishing uses npm OIDC trusted publishing — there is no token anywhere.**
npm mints a short-lived credential from the workflow's OIDC identity and accepts
a publish only from this repo + workflow filename. Provenance attestations are
generated automatically (no `--provenance` flag), which is what puts the
"Published via GitHub Actions" badge on the npm page.

This is not merely nicer than a token, it is the surviving option: npm granular
access tokens configured to bypass 2FA lost account-management powers on
2026-07-31 and lose **direct publish around January 2027**, after which they can
only stage a publish for interactive 2FA approval. Any local publish token is
therefore a dead end — don't reintroduce one.

Two things must stay in sync or publishing breaks in a confusing way:

- The trusted-publisher registration on npmjs.com names the workflow **file**
  (`release.yml`). Renaming the workflow file silently revokes publish rights.
- `npm run pack:inspect` and the `publish-rehearsal` CI job assert the same
  contract from `scripts/tarball-contract.mjs`. Add a required file there, not
  in either caller.

## Publishing a site

A consumer project adopts vibedocs as a static-site engine by copying three example artefacts and wiring them to AWS (S3 + CloudFront):

- `examples/release.yml.template` — GitHub Actions workflow (checkout → `npm ci` → `npx vibedocs build` → `aws s3 sync` → `cloudfront create-invalidation`). All consumer-specific values are `{{REPLACE_ME}}` markers. Action versions are pinned (`actions/checkout@v4`, `actions/setup-node@v4`, `aws-actions/configure-aws-credentials@v4`).
- `examples/.vibedocs.config.example.ts` — fully-annotated `SiteConfig` example. Every field documented with when-to-use comments; required fields (`name`, `domain`, `description`, `theme.tokens`, `llms`) uncommented, optional fields commented out.
- `docs/adopt-vibedocs.md` — operator integration guide: one-time AWS prereqs (S3 bucket, CloudFront distribution, ACM cert in us-east-1, DNS record), adding the `github:danielcbright/vibedocs` dep, dropping in the workflow + config, the GitHub Actions secrets to set (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, least-privilege IAM, optional OIDC), and a troubleshooting table.

This is the vibedocs-side capstone of the publishable-static-site engine (#45 spec §4). The per-customer adoption (each consumer repo creating its own `release.yml` + `.vibedocs.config.ts` and going live) is out of scope — these are the templates customers pick up. When the `vibedocs build` CLI surface changes (see `src/cli/index.ts` `USAGE`), keep the `--help` block in `docs/adopt-vibedocs.md` and the build command in `examples/release.yml.template` in sync.

## Deployment

**macOS:** `scripts/install-macos.sh` installs a LaunchAgent that starts at
login. It *asks which folders to index* rather than assuming a root — a home
directory typically contains `~/Library` (thousands of directories of
application state) and often employer-synced folders, and neither belongs in a
documentation browser. Selected folders are symlinked into `~/.vibedocs/roots`
and `VIBEDOCS_ROOT` points there; discovery uses `stat`, not `lstat`, so each
symlink resolves to a project. Changing the selection later is adding or
removing a link. The script is also drivable non-interactively
(`--folders a,b,c --yes`) for an agent installing on someone's behalf.

**macOS privacy controls are the trap here.** `~/Documents`, `~/Desktop` and
`~/Downloads` are TCC-protected. A LaunchAgent whose roots include one of them
starts, blocks *before* binding its port, and writes **nothing** to either log —
`launchctl` reports it running, `lsof` shows no sockets, and CPU sits at 0%. It
looks like a hang in vibedocs and is not: the same roots serve in seconds from a
shell that already has permission. Either grant Full Disk Access to the `node`
binary, or leave those folders out. The installer flags them in its picker and
health-checks the port after loading rather than claiming success blindly.

**Linux:** an optional systemd unit file is provided in `systemd/vibedocs.service`. Edit the placeholder paths, then run `scripts/setup-service.sh` to install it. Use `scripts/promote.sh` to build, validate, and restart the service after code changes.

### Exposing beyond localhost (tailnet, LAN, public)

The WebSocket handshake enforces an Origin allowlist (see `src/ws-auth.ts`). The defaults (`http://localhost:8080`, `http://localhost:5173`, `http://localhost:${PORT}`, plus the same three on `127.0.0.1`) cover local dev. Both spellings are listed because browsers treat `localhost` and `127.0.0.1` as distinct origins while they address the same loopback interface — trusting only one bought no security (a remote page can forge neither) and cost live reload for anyone who typed the IP, which `vibedocs serve --port N` makes common. **When exposing vibedocs on any other origin, set `VIBEDOCS_WS_ALLOWED_ORIGINS` to a comma-separated list of every URL the browser will load the app from**, otherwise live reload will silently fail (the page loads, the WS upgrade returns 401).

Example for a tailnet hostname:

```
Environment=VIBEDOCS_WS_ALLOWED_ORIGINS=http://<your-tailnet-host>:8080
```

Without this, cross-origin pages cannot establish WebSocket connections — which is the point: it blocks cross-site WebSocket hijacking (CSWSH) where a page on `attacker.com` opens a WS to vibedocs and observes reload broadcasts.

## Development Notes

- Frontend dependencies are in `frontend/package.json` (separate from root)
- shadcn/ui components go in `frontend/src/components/ui/` (configured via `frontend/components.json`)
- The `frontend/dist/` and `frontend/node_modules/` directories are gitignored
- Backend tsconfig is at root; frontend tsconfig is at `frontend/tsconfig.json`
- Path alias `@/` resolves to `frontend/src/` in the frontend code
- The `files:` array in `package.json` is an enforceable public surface — changes to it require updating `tests/package-shape.test.ts` to match
- The `prepare` lifecycle script is `scripts/prepare.mjs`. `prepare` fires on every `npm install`, including local self-installs where the ~13s Vite frontend build is pure waste. The script skips that build when `INIT_CWD === <package dir>` (npm's signal for a self-install in the source repo) and runs it otherwise (consumer git-dep installs, where `frontend/dist/` genuinely must materialize). `build:cli` (cheap `tsc`) and husky hook setup run in both paths; husky is best-effort so a consumer's prod-deps install (no husky devDep, no git repo) doesn't break.
