# CLAUDE.md - VibeDocs

<!-- argus
port: 8080
name: vibedocs
health_path: /healthz
description: Markdown docs renderer for workspace projects
-->

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

Upload route gate ordering (matches `src/upload-auth.ts`):

1. **Read-only check** → 404 (precedence over everything)
2. **No token configured** → 404 (don't reveal the endpoint exists)
3. **Token mismatch** → 401
4. **Denied extension** → 400 (allowlist: `.md .markdown .png .jpg .jpeg .gif .webp .pdf .txt`; deny: `.html .htm .xhtml .svg .js .mjs .json .css .wasm`)
5. **Per-file size cap exceeded** → 413
6. **Success** → 200 `{ data: WriteResult[] }`

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
  upload-auth.ts        # parseUploadAuthConfig, checkUploadAuth, checkExtensionAllowed (pure policy fns)
  discovery.ts          # Project/file tree discovery (all file types, isAsset flag)
  markdown.ts           # Markdown render pipeline (remark/rehype/shiki + remarkMermaid + rehypeWrapTables)
  search.ts             # In-memory full-text search index (factory, versioned)
  upload.ts             # safeWriteFile(targetDir: SafePath, ...): conflict renaming + safe writes
  path-resolver.ts      # PathResolver: validates project+path → SafePath; throws VibedocsError
  errors.ts             # VibedocsError taxonomy + registerErrorHandler (single HTTP translation point)
  shared/ws-messages.ts # Typed WS message envelope (shared with frontend)
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
- **Upload auth:** `src/upload-auth.ts` exposes pure functions used by `src/upload-route.ts`: `parseUploadAuthConfig(env)` reads `VIBEDOCS_UPLOAD_TOKEN`/`VIBEDOCS_READ_ONLY`/`VIBEDOCS_UPLOAD_MAX_BYTES`; `checkUploadAuth(cfg, authHeader)` returns a discriminated `'read-only' | 'no-token-configured' | 'unauthorized' | 'ok'`; `checkExtensionAllowed(filename)` enforces an allowlist (`.md`, images, `.pdf`, `.txt`) with explicit deny for `.html`/`.svg`/`.js`/etc. Read-only mode hides the endpoint (404) regardless of token; an unset token also returns 404 (not 401) so unauthenticated scanners can't fingerprint the feature. Bearer-token comparison is constant-time (`crypto.timingSafeEqual`).
- **Mobile tap-targets:** `frontend/src/index.css` `@media (hover: none) and (pointer: coarse)` block exposes `.tap-target` (44×44), `.tap-row` (44px min-height), `.tap-visible-on-touch` (overrides hover-revealed UI), `.tap-active-feedback` (visible :active background). Prefer these on new mobile-facing controls over bespoke responsive sizing.
- **Navigation:** `frontend/src/App.tsx` `navigateSmart(project, path)` — file paths navigate directly; empty/folder paths resolve to the first markdown file under that scope via depth-first tree walk. Used by `DocContent` (so breadcrumb folder/project clicks land on a real doc). Sidebar uses plain `navigate` since its clicks always have full file paths.
- **Discovery:** `buildTree()` includes all file types; non-markdown files get `isAsset: true` flag. Root-level discovery stays markdown-only.
- **File watcher:** Watches all files (`**/*`), but only rebuilds search index for markdown changes

## Deployment

An optional systemd unit file is provided in `systemd/vibedocs.service`. Edit the placeholder paths, then run `scripts/setup-service.sh` to install it. Use `scripts/promote.sh` to build, validate, and restart the service after code changes.

### Exposing beyond localhost (tailnet, LAN, public)

The WebSocket handshake enforces an Origin allowlist (see `src/ws-auth.ts`). The defaults (`http://localhost:8080`, `http://localhost:5173`, `http://localhost:${PORT}`) cover local dev. **When exposing vibedocs on any other origin, set `VIBEDOCS_WS_ALLOWED_ORIGINS` to a comma-separated list of every URL the browser will load the app from**, otherwise live reload will silently fail (the page loads, the WS upgrade returns 401).

Example for a tailnet hostname:

```
Environment=VIBEDOCS_WS_ALLOWED_ORIGINS=http://claudebot.tailc9eea3.ts.net:8080
```

Without this, cross-origin pages cannot establish WebSocket connections — which is the point: it blocks cross-site WebSocket hijacking (CSWSH) where a page on `attacker.com` opens a WS to vibedocs and observes reload broadcasts.

## Development Notes

- Frontend dependencies are in `frontend/package.json` (separate from root)
- shadcn/ui components go in `frontend/src/components/ui/` (configured via `frontend/components.json`)
- The `frontend/dist/` and `frontend/node_modules/` directories are gitignored
- Backend tsconfig is at root; frontend tsconfig is at `frontend/tsconfig.json`
- Path alias `@/` resolves to `frontend/src/` in the frontend code
- The `files:` array in `package.json` is an enforceable public surface — changes to it require updating `tests/package-shape.test.ts` to match
