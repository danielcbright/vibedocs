# CLAUDE.md - VibeDocs

## Project Overview

VibeDocs — self-hosted documentation browser for the claudebot workspace. Hono backend + React frontend that auto-discovers markdown files across all `~/claudebot/projects/` and renders them with rich formatting.

**Port:** 8080
**Status:** Active Development (v0.2.0)
**Service:** Runs as a systemd user service (`vibedocs`), always on, starts on boot.

## Deployment Model

This app runs **continuously on the host** on port 8080. The user relies on it daily to browse project documentation, plans, and markdown files across the workspace.

- The systemd service serves `frontend/dist/` (pre-built) via the Hono backend.
- `frontend/dist/` is **only updated through `./scripts/promote.sh`** — not by `npm run build` alone.
- **After ANY code change (backend or frontend), you MUST promote:**
  ```bash
  ./scripts/promote.sh    # builds, validates, restarts service, health-checks
  ```
- If you skip promotion, the running service serves stale content.

## Tech Stack

- **Backend:** Node.js + Hono 4 + TypeScript
- **Frontend:** React 19 + Vite + shadcn/ui + Tailwind CSS v4
- **Markdown:** unified/remark/rehype + Shiki (syntax highlighting) + Mermaid (diagrams)
- **Live Reload:** chokidar (file watching) + WebSocket (ws)

## Project Structure

```
src/                    # Backend (Hono server)
  server.ts             # HTTP server, API routes, WebSocket, SPA fallback
  discovery.ts          # Project/file tree discovery
  markdown.ts           # Markdown rendering pipeline (remark/rehype/shiki)
  search.ts             # In-memory full-text search index
frontend/               # Frontend (Vite React app)
  src/
    App.tsx             # Root layout (sidebar + content + TOC)
    components/         # React components
    components/ui/      # shadcn/ui components (auto-generated)
    hooks/              # Custom hooks (projects, document, websocket, search)
    lib/utils.ts        # cn() utility
    index.css           # Tailwind + theme vars + markdown prose styles
  vite.config.ts        # Vite config with API proxy
  components.json       # shadcn/ui config
systemd/
  vibedocs.service    # systemd user service unit file
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
npm start             # Production: serve everything from Hono on 8080
```

## Service Management

The app runs as a **systemd user service** that starts on boot via lingering.

```bash
# Service control
systemctl --user status vibedocs     # Check status
systemctl --user restart vibedocs    # Restart
systemctl --user stop vibedocs       # Stop (e.g. before dev)
systemctl --user start vibedocs      # Start

# Logs
journalctl --user -u vibedocs -f     # Follow logs
journalctl --user -u vibedocs -n 50  # Last 50 lines
```

### Promotion Workflow

Use `./scripts/promote.sh` to deploy changes to the running service:

1. Warns about uncommitted changes
2. Installs backend dependencies
3. Builds frontend (`vite build`)
4. Validates build artifacts
5. Restarts systemd service
6. Health-checks `/api/projects`

### Developer Workflow

**The full cycle is: stop service → develop → promote. Never leave the service stopped or stale.**

```bash
# 1. Stop service first (port 8080 conflict otherwise)
systemctl --user stop vibedocs

# 2. Develop with hot reload
npm run dev                              # Vite HMR on 5173, Hono on 8080

# 3. When done (Ctrl+C), ALWAYS promote to update the running service
./scripts/promote.sh                     # Build + validate + restart service
```

### First-Time Setup

Run once after cloning: `./scripts/setup-service.sh`
This symlinks the unit file, enables lingering, and enables the service.

## API Routes

- `GET /api/projects` - Project list with file trees
- `GET /api/render/:project/*` - Render markdown to HTML + TOC
- `GET /api/raw/:project/*` - Raw markdown content
- `GET /api/search?q=` - Full-text search

## Key Patterns

- **Hash routing:** URLs use `#project/path/to/file.md` format
- **Dual-theme Shiki:** CSS variables (`--shiki-light`/`--shiki-dark`) toggle with `.dark` class
- **Mermaid:** Client-side rendering via CDN ESM import, re-initializes on theme change
- **WebSocket messages:** `{ type: 'reload' }` for file changes, `{ type: 'refresh-tree' }` for add/remove
- **SPA fallback:** In production, all non-API GET requests return `frontend/dist/index.html`
- **Search index:** Rebuilt in-memory on startup and on file watcher events

## Gotchas

- **Port 8080 conflict:** The systemd service and `npm run dev` both use port 8080. Always `systemctl --user stop vibedocs` before dev mode.
- **`frontend/dist/` is not auto-built:** `npm run build` alone does NOT restart the service. Always use `./scripts/promote.sh`.
- **Service runs on boot:** After reboot, the service starts automatically — no manual intervention needed.
- **Two package.jsons:** Root has backend deps; `frontend/package.json` has frontend deps. `promote.sh` handles both.

## Development Notes

- Frontend dependencies are in `frontend/package.json` (separate from root)
- shadcn/ui components go in `frontend/src/components/ui/` (configured via `frontend/components.json`)
- The `frontend/dist/` and `frontend/node_modules/` directories are gitignored
- Backend tsconfig is at root; frontend tsconfig is at `frontend/tsconfig.json`
- Path alias `@/` resolves to `frontend/src/` in the frontend code
