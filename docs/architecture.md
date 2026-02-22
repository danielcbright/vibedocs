# Architecture

## Overview

vibedocs is a self-hosted documentation browser with a **Hono backend** and **React + shadcn/ui frontend**. It auto-discovers markdown files across all workspace projects and renders them with syntax highlighting, diagrams, and live reload.

## System Diagram

```mermaid
graph LR
    subgraph Browser["Browser (React SPA)"]
        direction TB
        UI["Sidebar | Content | TOC"]
        Search["Search (Ctrl+K)"]
    end

    subgraph Server["Hono Server :8080"]
        direction TB
        API["/api/* routes"]
        Static["Static / SPA"]
        WS["WebSocket"]
        subgraph Core["Core Modules"]
            direction LR
            Discovery["Discovery"]
            MD["Markdown"]
            Idx["Search Index"]
            Watch["Chokidar"]
        end
        API --> Core
        WS --> Watch
    end

    Browser -- "HTTP + WS" --> Server
    Core -- "reads" --> Disk[("$VIBEDOCS_ROOT\n(markdown on disk)")]
```

## Backend (src/)

### server.ts - HTTP Server

The main entry point. Uses Hono for routing on port 8080.

**API Routes:**
- `GET /api/projects` - Returns project list with file trees (calls `discovery.ts`)
- `GET /api/render/:project/*` - Renders markdown to HTML + TOC (calls `markdown.ts`)
- `GET /api/raw/:project/*` - Returns raw markdown content (for copy button)
- `GET /api/search?q=` - Full-text search across all indexed files (calls `search.ts`)

**Static File Serving (production):**
- Serves `frontend/dist/` assets for all non-API routes
- SPA fallback: any unmatched GET returns `index.html` so hash routing works

**WebSocket:**
- Attached to the same HTTP server
- Broadcasts `reload` (file changed) and `refresh-tree` (file added/removed) messages

### discovery.ts - Project Discovery

Scans the configured root directory (`VIBEDOCS_ROOT`) for directories containing `.md` files. Builds a recursive file tree structure for each project. Excludes `node_modules`, `.git`, `dist`, and other non-documentation directories.

**Key types:**
- `FileNode` - `{ name, path, type: 'file' | 'folder', children? }`
- `ProjectInfo` - `{ name, hasDocsFolder, tree: FileNode[] }`

### markdown.ts - Rendering Pipeline

Processes markdown through a unified/remark/rehype pipeline:

```
Markdown → remark-parse → remark-gfm → remarkMermaid (custom)
  → remark-rehype → @shikijs/rehype → rehype-slug
  → rehype-autolink-headings → rehype-stringify → HTML
```

- **Shiki** provides dual-theme syntax highlighting (github-light + github-dark)
- **remarkMermaid** converts ` ```mermaid ` blocks to `<div class="mermaid">` for client-side rendering
- **rehype-slug** + **rehype-autolink-headings** make headings linkable
- `extractToc(html)` parses h1-h3 headings from rendered HTML for the TOC

### search.ts - Full-Text Search

In-memory search index built on startup and rebuilt on file watcher events.

- Reads all `.md` files from discovered projects
- Stores lowercase content for case-insensitive matching
- `search(query)` scans content, returns matches with ~100 char context snippets
- Limited to 20 results per query

## Frontend (frontend/)

Built with **Vite + React 19 + TypeScript + shadcn/ui + Tailwind CSS v4**.

### Build & Dev

- **Development:** `npm run dev` starts both Hono (8080) and Vite dev server (5173) via `concurrently`. Vite proxies `/api/*` to the backend.
- **Production:** `npm run build` outputs to `frontend/dist/`. Hono serves it as static files.

### Component Architecture

```
App.tsx
├── ThemeProvider (light/dark/system, localStorage)
├── TooltipProvider
├── SidebarProvider
│   ├── AppSidebar
│   │   ├── ThemeToggle
│   │   ├── Filter Input
│   │   └── Project Tree (recursive Collapsible)
│   └── SidebarInset
│       ├── Header (SidebarTrigger + project name)
│       └── Content Area
│           ├── DocContent
│           │   ├── BreadcrumbNav
│           │   ├── Copy Button
│           │   ├── ConnectionStatus
│           │   └── Rendered HTML (prose-content)
│           └── TocPanel (scroll-spy)
└── SearchDialog (Ctrl+K command palette)
```

### Custom Hooks

| Hook | Purpose |
|------|---------|
| `use-projects` | Fetches `/api/projects`, returns project list with refresh |
| `use-document` | Fetches `/api/render/:project/:path`, returns HTML + TOC |
| `use-websocket` | Connects to WebSocket, handles reconnect, fires callbacks |
| `use-search` | Debounced fetch to `/api/search?q=`, returns results |

### Routing

Hash-based routing: `#project/path/to/file.md`. Parsed on load and on `hashchange` events. No client-side router library needed.

### Styling

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin
- **shadcn/ui** components with CSS variables for theming
- **Custom `prose-content` class** in `index.css` for rendered markdown (headings, code blocks, tables, blockquotes, lists, etc.)
- **Shiki dual-theme** CSS: uses `--shiki-light` / `--shiki-dark` CSS variables, toggled by `.dark` class
- **Mermaid diagrams** rendered client-side via CDN import

### shadcn/ui Components Used

sidebar, command, dialog, breadcrumb, scroll-area, collapsible, button, input, tooltip, badge, separator, skeleton, dropdown-menu, resizable, sheet

## Data Flow

### Document Loading
1. User clicks file in sidebar → sets `window.location.hash`
2. `hashchange` event → `App.tsx` parses project + path
3. `use-document` hook fetches `/api/render/:project/:path`
4. Backend reads file, runs through markdown pipeline, extracts TOC
5. Returns `{ html, toc }` → React renders HTML + TOC panel

### Live Reload
1. Chokidar watches `$VIBEDOCS_ROOT/**/*.md`
2. File change → broadcasts `{ type: 'reload' }` via WebSocket
3. `use-websocket` hook receives message → triggers `use-document` refresh
4. File add/remove → broadcasts `{ type: 'refresh-tree' }` → triggers `use-projects` refresh
5. Search index is also rebuilt on file changes

### Search
1. User presses Ctrl+K → search dialog opens
2. Typing triggers debounced (250ms) fetch to `/api/search?q=`
3. Backend scans in-memory index for matches
4. Results grouped by project in the command palette
5. Selecting a result sets `window.location.hash` → navigates to document
