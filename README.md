# VibeDocs

Self-hosted documentation browser for the claudebot workspace. Reads markdown from all project `docs/` folders and renders them with rich formatting.

## Overview

A Hono backend + React frontend that auto-discovers all projects under `~/claudebot/projects/`, renders their markdown files with syntax highlighting, diagrams, and a table of contents, and live-reloads the browser when files change.

## Tech Stack

- **Runtime:** Node.js v24
- **Backend:** Hono 4 + @hono/node-server
- **Frontend:** React 19 + TypeScript + Vite + shadcn/ui + Tailwind CSS v4
- **Markdown:** unified / remark / rehype pipeline
- **Syntax Highlighting:** Shiki (github-dark / github-light)
- **Diagrams:** Mermaid.js (client-side)
- **Live Reload:** chokidar + WebSocket (ws)

## Prerequisites

- Node.js >= 24.0.0

## Installation

```bash
cd ~/claudebot/projects/vibedocs
npm install
npm run build   # Build the frontend
```

## Development

```bash
npm run dev   # Start both Hono (8080) and Vite dev server (5173)
```

- **Frontend dev server:** http://localhost:5173 (with hot reload)
- **Backend API:** http://localhost:8080

The Vite dev server proxies `/api/*` requests to the Hono backend.

### Individual servers

```bash
npm run dev:server    # Backend only (port 8080)
npm run dev:frontend  # Vite dev server only (port 5173)
```

## Production

```bash
npm run build   # Build frontend to frontend/dist/
npm start       # Serve everything from Hono on port 8080
```

## Project Structure

```
src/
  server.ts       - Hono server, WebSocket, file watcher, SPA fallback
  markdown.ts     - remark/rehype/shiki rendering pipeline
  discovery.ts    - Project and file tree discovery
  search.ts       - Full-text search index
frontend/
  src/
    App.tsx         - Root layout with sidebar + content + TOC
    components/     - React components (sidebar, content, search, etc.)
    hooks/          - Custom hooks (projects, document, websocket, search)
    lib/            - Utilities (cn helper)
    index.css       - Tailwind + markdown prose styles
  components.json   - shadcn/ui configuration
  vite.config.ts    - Vite config with API proxy
```

## Features

- Auto-discovers all workspace projects
- Handles `docs/` folders and root-level markdown
- Shiki syntax highlighting (dual light/dark themes)
- Mermaid diagram rendering
- Auto-generated table of contents with scroll-spy
- WebSocket live reload on `.md` file changes
- Full-text search with Ctrl+K command palette
- Collapsible sidebar with file tree filtering
- Dark/light/system theme modes
- Hash-based URL routing
- Resizable sidebar panel

## Status

**Current Version:** 0.2.0
**Status:** Active Development
**Last Updated:** 2026-02-21
**Port:** 8080

---

**Part of:** `/home/dbright/claudebot/` workspace
**Repository:** https://github.com/danielcbright/vibedocs
**Maintained by:** danielcbright
