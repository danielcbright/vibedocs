# CLAUDE.md - VibeDocs

## Project Overview

VibeDocs — self-hosted markdown documentation browser. Hono backend + React frontend that auto-discovers markdown files across project directories and renders them with rich formatting.

**Port:** 8080 (configurable via `VIBEDOCS_PORT` or `PORT`)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VIBEDOCS_ROOT` | `process.cwd()` | Root directory to scan for project folders |
| `VIBEDOCS_PORT` or `PORT` | `8080` | Server port |
| `VIBEDOCS_WS_ALLOWED_ORIGINS` | _(unset)_ | Comma-separated extra Origin allowlist for the WebSocket handshake. Defaults always include `http://localhost:8080`, `http://localhost:5173`, and `http://localhost:${PORT}`. Add tailnet/public hostnames here (e.g. `http://vibedocs.tailnet:8080`) when exposing vibedocs beyond localhost. |
| `VIBEDOCS_WS_ALLOW_NO_ORIGIN` | `false` | When `true`, accept WS handshakes with no `Origin` header (non-browser clients like `wscat`). Default denies them so the threat model stays browser-driven CSWSH. |
| `VIBEDOCS_UPLOAD_TOKEN` | _(unset)_ | Shared-secret bearer token gating `POST /api/upload/*`. When unset, the upload endpoint returns 404 (safe by default — uploads disabled). When set, requests must send `Authorization: Bearer <token>`. |
| `VIBEDOCS_READ_ONLY` | `false` | When truthy (`true`/`1`/`yes`/`on`), `POST /api/upload/*` returns 404 unconditionally — even with a valid token. Frontend upload UI is hidden. Read-only takes precedence over the token gate. |
| `VIBEDOCS_UPLOAD_MAX_BYTES` | `10485760` (10 MB) | Per-file upload size cap. Files exceeding this return 413. |

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

- Search dialog (Ctrl+K) — gone until Pagefind slice #56 lands AND a static Pagefind integration is wired
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
  render.ts             # renderProject orchestration: per-project walk, missingRefs detection, RenderResult assembly
  markdown-processor.ts # createMarkdownProcessor(opts) factory — unified() pipeline (remark/rehype/shiki/mermaid/sanitize)
  url-rewriter.ts       # rehypeRewriteUrls + RewriteOptions + RenderMode — pure URL transformation by mode
  reference-collector.ts # createReferenceCollector — captures resolved asset refs during build for missing-ref detection
  search.ts             # In-memory full-text search index (factory, versioned)
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
```

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
- **Search index:** Rebuilt in-memory on startup and on markdown file watcher events
- **Path validation:** `src/path-resolver.ts` — `PathResolver` returns a `SafePath` branded type that downstream FS calls require; throws typed `VibedocsError` (traversal / invalid / not-found) on failure. Two instances (`docResolver`, `assetResolver`) configured at server startup.
- **File upload:** `src/upload.ts` `safeWriteFile(targetDir: SafePath, ...)` does filename sanitization via `path.basename()` and conflict auto-renaming (`file-1.ext`, `file-2.ext`, up to 100 suffixes). Path validation happens earlier at the resolver.
- **Upload auth:** `src/upload-auth.ts` exposes pure functions used by `src/upload-pipeline.ts`: `parseUploadAuthConfig(env)` reads `VIBEDOCS_UPLOAD_TOKEN`/`VIBEDOCS_READ_ONLY`/`VIBEDOCS_UPLOAD_MAX_BYTES`; `checkUploadAuth(cfg, authHeader)` returns a discriminated `'read-only' | 'no-token-configured' | 'unauthorized' | 'ok'`; `checkExtensionAllowed(filename)` enforces an allowlist (`.md`, images, `.pdf`, `.txt`) with explicit deny for `.html`/`.svg`/`.js`/etc. Read-only mode hides the endpoint (404) regardless of token; an unset token also returns 404 (not 401) so unauthenticated scanners can't fingerprint the feature. Bearer-token comparison is constant-time (`crypto.timingSafeEqual`).
- **Upload pipeline:** `src/upload-pipeline.ts` composes the auth policy + extension/size checks into a typed, ordered `UPLOAD_GATES` array — each gate is a tagged `UploadGate` with a `phase: 'auth' | 'content'` field. The route handler in `src/upload-route.ts` calls `runPipelinePhase('auth', ctx)` first (no body parse needed) then `runPipelinePhase('content', ctx)` after parsing files. Gate ordering is enforced by code: `tests/upload-pipeline.test.ts` asserts both the exact `UPLOAD_GATES.map(g => g.name)` sequence and the phase invariant (every auth gate precedes every content gate).
- **Mobile tap-targets:** `frontend/src/index.css` `@media (hover: none) and (pointer: coarse)` block exposes `.tap-target` (44×44), `.tap-row` (44px min-height), `.tap-visible-on-touch` (overrides hover-revealed UI), `.tap-active-feedback` (visible :active background). Prefer these on new mobile-facing controls over bespoke responsive sizing.
- **Navigation:** `frontend/src/App.tsx` `navigateSmart(project, path)` — file paths navigate directly; empty/folder paths resolve to the first markdown file under that scope via depth-first tree walk. Used by `DocContent` (so breadcrumb folder/project clicks land on a real doc). Sidebar uses plain `navigate` since its clicks always have full file paths.
- **Discovery:** `buildTree()` includes all file types; non-markdown files get `isAsset: true` flag. Root-level discovery stays markdown-only.
- **File watcher:** Watches all files (`**/*`), but only rebuilds search index for markdown changes

## Publishing a site

A consumer project adopts vibedocs as a static-site engine by copying three example artefacts and wiring them to AWS (S3 + CloudFront):

- `examples/release.yml.template` — GitHub Actions workflow (checkout → `npm ci` → `npx vibedocs build` → `aws s3 sync` → `cloudfront create-invalidation`). All consumer-specific values are `{{REPLACE_ME}}` markers. Action versions are pinned (`actions/checkout@v4`, `actions/setup-node@v4`, `aws-actions/configure-aws-credentials@v4`).
- `examples/.vibedocs.config.example.ts` — fully-annotated `SiteConfig` example. Every field documented with when-to-use comments; required fields (`name`, `domain`, `description`, `theme.tokens`, `llms`) uncommented, optional fields commented out.
- `docs/adopt-vibedocs.md` — operator integration guide: one-time AWS prereqs (S3 bucket, CloudFront distribution, ACM cert in us-east-1, DNS record), adding the `github:danielcbright/vibedocs` dep, dropping in the workflow + config, the GitHub Actions secrets to set (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, least-privilege IAM, optional OIDC), and a troubleshooting table.

This is the vibedocs-side capstone of the publishable-static-site engine (#45 spec §4). The per-customer adoption (each consumer repo creating its own `release.yml` + `.vibedocs.config.ts` and going live) is out of scope — these are the templates customers pick up. When the `vibedocs build` CLI surface changes (see `src/cli/index.ts` `USAGE`), keep the `--help` block in `docs/adopt-vibedocs.md` and the build command in `examples/release.yml.template` in sync.

## Deployment

An optional systemd unit file is provided in `systemd/vibedocs.service`. Edit the placeholder paths, then run `scripts/setup-service.sh` to install it. Use `scripts/promote.sh` to build, validate, and restart the service after code changes.

### Exposing beyond localhost (tailnet, LAN, public)

The WebSocket handshake enforces an Origin allowlist (see `src/ws-auth.ts`). The defaults (`http://localhost:8080`, `http://localhost:5173`, `http://localhost:${PORT}`) cover local dev. **When exposing vibedocs on any other origin, set `VIBEDOCS_WS_ALLOWED_ORIGINS` to a comma-separated list of every URL the browser will load the app from**, otherwise live reload will silently fail (the page loads, the WS upgrade returns 401).

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
