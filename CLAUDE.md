# CLAUDE.md - VibeDocs

## Project Overview

VibeDocs — self-hosted markdown documentation browser. Hono backend + React frontend that auto-discovers markdown files across project directories and renders them with rich formatting.

**Port:** 8080 (configurable via `VIBEDOCS_PORT` or `PORT`)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VIBEDOCS_ROOT` | `process.cwd()` | Root directory to scan for project folders |
| `VIBEDOCS_PORT` or `PORT` | `8080` | Server port |

## Tech Stack

- **Backend:** Node.js + Hono 4 + TypeScript
- **Frontend:** React 19 + Vite + shadcn/ui + Tailwind CSS v4
- **Markdown:** unified/remark/rehype + Shiki (syntax highlighting) + Mermaid (diagrams)
- **Live Reload:** chokidar (file watching) + WebSocket (ws)

## Project Structure

```
src/                    # Backend (Hono server)
  server.ts             # HTTP server, API routes, WebSocket, SPA fallback
  discovery.ts          # Project/file tree discovery (all file types, isAsset flag)
  markdown.ts           # Markdown rendering pipeline (remark/rehype/shiki)
  search.ts             # In-memory full-text search index
  upload.ts             # File upload: path validation, conflict renaming, safe writes
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
tests/                  # Backend tests (vitest)
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
- `POST /api/upload/:project/*` - Upload files to a project folder (multipart form data)
- `GET /api/file/:project/*` - Serve non-markdown files (images, PDFs, etc.)

## Key Patterns

- **Hash routing:** URLs use `#project/path/to/file.md` format
- **Dual-theme Shiki:** CSS variables (`--shiki-light`/`--shiki-dark`) toggle with `.dark` class
- **Mermaid:** Client-side rendering via CDN ESM import, re-initializes on theme change
- **WebSocket messages:** `{ type: 'reload' }` for markdown changes, `{ type: 'refresh-tree' }` for any file add/remove
- **SPA fallback:** In production, all non-API GET requests return `frontend/dist/index.html`
- **Search index:** Rebuilt in-memory on startup and on markdown file watcher events
- **File upload:** `src/upload.ts` handles path validation (two-layer traversal protection), filename sanitization via `path.basename()`, and conflict auto-renaming (`file-1.ext`, `file-2.ext`, up to 100 suffixes)
- **Discovery:** `buildTree()` includes all file types; non-markdown files get `isAsset: true` flag. Root-level discovery stays markdown-only.
- **File watcher:** Watches all files (`**/*`), but only rebuilds search index for markdown changes

## Deployment

An optional systemd unit file is provided in `systemd/vibedocs.service`. Edit the placeholder paths, then run `scripts/setup-service.sh` to install it. Use `scripts/promote.sh` to build, validate, and restart the service after code changes.

## Development Notes

- Frontend dependencies are in `frontend/package.json` (separate from root)
- shadcn/ui components go in `frontend/src/components/ui/` (configured via `frontend/components.json`)
- The `frontend/dist/` and `frontend/node_modules/` directories are gitignored
- Backend tsconfig is at root; frontend tsconfig is at `frontend/tsconfig.json`
- Path alias `@/` resolves to `frontend/src/` in the frontend code
