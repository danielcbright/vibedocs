# docs-browser

Self-hosted documentation browser for the claudebot workspace. Reads markdown from all project `docs/` folders and renders them with rich formatting.

## Overview

A lightweight Hono server that auto-discovers all projects under `~/claudebot/projects/`, renders their markdown files with syntax highlighting, diagrams, and a table of contents, and live-reloads the browser when files change.

## Tech Stack

- **Runtime:** Node.js v24
- **Framework:** Hono 4 + @hono/node-server
- **Markdown:** unified / remark / rehype pipeline
- **Syntax Highlighting:** Shiki (github-dark / github-light)
- **Diagrams:** Mermaid.js (client-side)
- **Live Reload:** chokidar + WebSocket (ws)
- **Frontend:** Vanilla JS + CSS (no build step)

## Prerequisites

- Node.js >= 24.0.0

## Installation

```bash
cd ~/claudebot/projects/docs-browser
npm install
```

## Development

```bash
npm run dev   # Start server at http://localhost:8080
```

**Local Server:** http://localhost:8080

## Project Structure

```
src/
  server.ts       - Hono server, WebSocket, file watcher
  markdown.ts     - remark/rehype/shiki rendering pipeline
  discovery.ts    - Project and file tree discovery
public/
  index.html      - SPA shell
  style.css       - Dark/light themes, markdown styles
  app.js          - Sidebar, navigation, TOC, live reload
```

## Features

- Auto-discovers all workspace projects
- Handles `docs/` folders and root-level markdown
- Shiki syntax highlighting (dual light/dark themes)
- Mermaid diagram rendering
- Auto-generated table of contents
- WebSocket live reload on `.md` file changes
- Sidebar search/filter
- Dark/light mode toggle
- Hash-based URL routing

## Status

**Current Version:** 0.1.0
**Status:** Active Development
**Last Updated:** 2026-02-19
**Port:** 8080

---

**Part of:** `/home/dbright/claudebot/` workspace
**Repository:** https://github.com/danielcbright/docs-browser
**Maintained by:** danielcbright
