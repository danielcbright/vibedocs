import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFile, access } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import chokidar from 'chokidar'
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'net'
import {
  discoverProjects,
  filterProjects,
  parseFileTypeFilter,
  toProjectRelativePath,
  PROJECTS_DIR,
} from './discovery.js'
import { renderSinglePage } from './render.js'
import { createIndexStore } from './search.js'
import { registerSearchRoute, registerFileRoute } from './server-routes.js'
import { registerUploadRoute, registerConfigRoute } from './upload-route.js'
import { parseUploadAuthConfig } from './upload-auth.js'
import { PathResolver } from './path-resolver.js'
import { loadSiteConfig } from './site-config.js'
import { createSiteConfigCache } from './site-config-cache.js'
import {
  reloadMessage,
  refreshTreeMessage,
  type WsMessage,
} from './shared/ws-messages.js'
import { VibedocsError, registerErrorHandler } from './errors.js'
import { parseAllowedOrigins, buildVerifyClient } from './ws-auth.js'
import { MARKDOWN_EXTENSIONS, isMarkdownPath } from './markdown-paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
const PORT = parseInt(process.env.VIBEDOCS_PORT || process.env.PORT || '8080', 10)

const app = new Hono()
const searchStore = createIndexStore({ projectsDir: PROJECTS_DIR })
const siteConfigCache = createSiteConfigCache({
  loadConfig: loadSiteConfig,
  projectsDir: PROJECTS_DIR,
})

// Two PathResolver instances differ only in their extension allowlist:
// - docResolver: markdown-only routes (render, raw)
// - assetResolver: arbitrary file routes (upload, file)
const docResolver = new PathResolver({
  projectsDir: PROJECTS_DIR,
  requireExtensions: MARKDOWN_EXTENSIONS,
})
const assetResolver = new PathResolver({ projectsDir: PROJECTS_DIR })

// Single error-translation point: VibedocsError → mapped status; anything else → 500.
// Routes throw typed errors instead of building HTTP responses inline.
registerErrorHandler(app)

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/projects', async (c) => {
  const fileType = parseFileTypeFilter(c.req.query('fileType'))
  const projects = await discoverProjects()
  const filtered = filterProjects(projects, fileType)
  // Attach each project's parsed .vibedocs.config.ts (or null). The cache
  // short-circuits filesystem work on subsequent requests; chokidar
  // invalidates entries when the source file changes (see watcher below).
  const withConfig = await Promise.all(
    filtered.map(async (p) => ({
      ...p,
      siteConfig: await siteConfigCache.get(p.name),
    })),
  )
  return c.json({ data: withConfig })
})

app.get('/api/render/:project/*', async (c) => {
  const project = c.req.param('project')
  // Extract the wildcard portion from the raw URL path
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/render/${encodeURIComponent(project)}/`
  const docPath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  if (!project || !docPath) {
    return c.json({ error: 'Missing project or path' }, 400)
  }

  // Resolver validates the path (traversal + extension) and returns a
  // `SafePath` we pass straight to `renderSinglePage`. The renderer's
  // signature requires a `SafePath` (not a raw string), so any future caller
  // that bypasses validation fails at compile time — see security #7.
  const safePath = docResolver.resolve(project, docPath)

  let page: Awaited<ReturnType<typeof renderSinglePage>>
  try {
    page = await renderSinglePage(safePath, project, docPath, 'live')
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
    throw new VibedocsError('io', 'Failed to render document', { cause: err })
  }
  return c.json({ data: { html: page.html, toc: page.toc } })
})

app.get('/api/raw/:project/*', async (c) => {
  const project = c.req.param('project')
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/raw/${encodeURIComponent(project)}/`
  const docPath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  if (!project || !docPath) {
    return c.json({ error: 'Missing project or path' }, 400)
  }

  const resolved = docResolver.resolve(project, docPath)

  let content: string
  try {
    content = await readFile(resolved, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
    throw new VibedocsError('io', 'Failed to read file', { cause: err })
  }
  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
})

registerSearchRoute(app, searchStore)

// Upload route is gated by env-var token + optional read-only flag.
// See src/upload-auth.ts and CLAUDE.md for the deployment-mode table.
const uploadAuthCfg = parseUploadAuthConfig(process.env)
registerConfigRoute(app, uploadAuthCfg)
registerUploadRoute(app, assetResolver, uploadAuthCfg, () => broadcast(refreshTreeMessage()))

registerFileRoute(app, assetResolver)

// ── Content types ─────────────────────────────────────────────────────────────
//
// This map is for serving the built SPA (`/assets/*` and SPA fallback) — not
// uploaded user content. The /api/file route uses a stricter map in
// `server-routes.ts` that excludes .html and .svg to prevent stored XSS.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// ── Static files (production: serve frontend/dist/) ──────────────────────────

async function serveStatic(filePath: string): Promise<Response | null> {
  try {
    await access(filePath)
    const content = await readFile(filePath)
    const ext = path.extname(filePath)
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    return null
  }
}

// Serve static assets from frontend/dist/
app.get('/assets/*', async (c) => {
  const urlPath = new URL(c.req.url).pathname
  const filePath = path.join(FRONTEND_DIST, urlPath)
  const response = await serveStatic(filePath)
  if (response) return response
  return c.text('Not found', 404)
})

// SPA fallback: serve index.html for all non-API routes
app.get('*', async (c) => {
  const urlPath = new URL(c.req.url).pathname

  // Try serving the exact file first (e.g., /favicon.ico)
  const exactFile = path.join(FRONTEND_DIST, urlPath)
  const exactResponse = await serveStatic(exactFile)
  if (exactResponse) return exactResponse

  // SPA fallback: serve index.html
  const indexPath = path.join(FRONTEND_DIST, 'index.html')
  const indexResponse = await serveStatic(indexPath)
  if (indexResponse) return indexResponse

  return c.text('Not found - run "npm run build" to build the frontend', 404)
})

// ── Server + WebSocket ────────────────────────────────────────────────────────

const server = serve(
  { fetch: app.fetch, port: PORT },
  () => {
    console.log(`\n📚 VibeDocs running at http://localhost:${PORT}\n`)
  }
)

// Attach WebSocket server to the same HTTP server.
// `verifyClient` enforces an Origin allowlist at the upgrade step. Browsers
// don't apply same-origin policy to WS handshakes, so without this check any
// page the operator visits could open a connection and observe reload
// broadcasts (CSWSH). See `src/ws-auth.ts` for the policy details.
const ALLOWED_WS_ORIGINS = parseAllowedOrigins({
  envValue: process.env.VIBEDOCS_WS_ALLOWED_ORIGINS,
  port: PORT,
})
const ALLOW_NO_ORIGIN = process.env.VIBEDOCS_WS_ALLOW_NO_ORIGIN === 'true'
console.log(`  🔒 WS origin allowlist: ${ALLOWED_WS_ORIGINS.join(', ')}`)
if (ALLOW_NO_ORIGIN) {
  console.log('  🔒 WS allows handshakes with no Origin header (VIBEDOCS_WS_ALLOW_NO_ORIGIN=true)')
}

// Upload mode banner — makes deployment configuration obvious in logs.
if (uploadAuthCfg.readOnly) {
  console.log('  🔒 Upload mode: READ-ONLY (VIBEDOCS_READ_ONLY=true) — POST /api/upload/* returns 404')
} else if (uploadAuthCfg.token === null) {
  console.log('  🔒 Upload mode: DISABLED (VIBEDOCS_UPLOAD_TOKEN unset) — POST /api/upload/* returns 404')
} else {
  console.log('  🔒 Upload mode: TOKEN (VIBEDOCS_UPLOAD_TOKEN set) — Authorization: Bearer required')
}

const wss = new WebSocketServer({
  server: server as unknown as Server,
  verifyClient: buildVerifyClient({
    allowedOrigins: ALLOWED_WS_ORIGINS,
    allowNoOrigin: ALLOW_NO_ORIGIN,
  }),
})

const clients = new Set<WebSocket>()

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

function broadcast(message: WsMessage) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

// ── File watcher ──────────────────────────────────────────────────────────────

const watchGlob = path.join(PROJECTS_DIR, '**/*')

function isSiteConfig(filePath: string): boolean {
  return path.basename(filePath) === '.vibedocs.config.ts'
}

function rebuildSearchIndex(): void {
  searchStore.rebuild().then((v) => {
    console.log(`  🔍 Search index v${v}: rebuilt`)
  }).catch((err) => {
    console.error('Search rebuild failed:', err)
  })
}

chokidar
  .watch(watchGlob, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/.git/**'],
  })
  .on('change', (filePath: string) => {
    const rel = toProjectRelativePath(filePath, PROJECTS_DIR)
    console.log(`  ↺  changed: ${rel ?? filePath}`)
    // Site-config edits: drop the cached entry so the next /api/projects
    // call re-parses the file. TODO(#62): each invalidation leaks one ESM
    // module entry — see src/site-config-cache.ts header.
    if (isSiteConfig(filePath)) siteConfigCache.invalidateFromPath(filePath)
    if (isMarkdownPath(filePath)) {
      // Only broadcast paths that resolve under PROJECTS_DIR. Anything else
      // would leak the absolute filesystem path to every connected client.
      if (rel !== null) broadcast(reloadMessage(rel))
      rebuildSearchIndex()
    } else {
      broadcast(refreshTreeMessage())
    }
  })
  .on('add', (filePath: string) => {
    const rel = toProjectRelativePath(filePath, PROJECTS_DIR)
    console.log(`  +  added:   ${rel ?? filePath}`)
    if (isSiteConfig(filePath)) siteConfigCache.invalidateFromPath(filePath)
    broadcast(refreshTreeMessage())
    if (isMarkdownPath(filePath)) {
      rebuildSearchIndex()
    }
  })
  .on('unlink', (filePath: string) => {
    const rel = toProjectRelativePath(filePath, PROJECTS_DIR)
    console.log(`  -  removed: ${rel ?? filePath}`)
    if (isSiteConfig(filePath)) siteConfigCache.invalidateFromPath(filePath)
    broadcast(refreshTreeMessage())
    if (isMarkdownPath(filePath)) {
      rebuildSearchIndex()
    }
  })
  .on('addDir', (dirPath: string) => {
    const rel = toProjectRelativePath(dirPath, PROJECTS_DIR)
    console.log(`  +  dir:     ${rel ?? dirPath}`)
    broadcast(refreshTreeMessage())
  })
  .on('unlinkDir', (dirPath: string) => {
    const rel = toProjectRelativePath(dirPath, PROJECTS_DIR)
    console.log(`  -  dir:     ${rel ?? dirPath}`)
    broadcast(refreshTreeMessage())
  })

// Build initial search index
rebuildSearchIndex()
