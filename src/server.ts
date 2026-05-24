import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFile, access, stat as fsStat } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import chokidar from 'chokidar'
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'net'
import {
  discoverProjects,
  filterProjects,
  parseFileTypeFilter,
  PROJECTS_DIR,
} from './discovery.js'
import { renderFile, extractToc } from './markdown.js'
import { createIndexStore } from './search.js'
import { registerSearchRoute } from './server-routes.js'
import { safeWriteFile } from './upload.js'
import { PathResolver } from './path-resolver.js'
import {
  reloadMessage,
  refreshTreeMessage,
  type WsMessage,
} from './shared/ws-messages.js'
import { VibedocsError, registerErrorHandler } from './errors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
const PORT = parseInt(process.env.VIBEDOCS_PORT || process.env.PORT || '8080', 10)

const app = new Hono()
const searchStore = createIndexStore({ projectsDir: PROJECTS_DIR })

// Two PathResolver instances differ only in their extension allowlist:
// - docResolver: markdown-only routes (render, raw)
// - assetResolver: arbitrary file routes (upload, file)
const docResolver = new PathResolver({
  projectsDir: PROJECTS_DIR,
  requireExtensions: ['.md', '.markdown'],
})
const assetResolver = new PathResolver({ projectsDir: PROJECTS_DIR })

// Single error-translation point: VibedocsError → mapped status; anything else → 500.
// Routes throw typed errors instead of building HTTP responses inline.
registerErrorHandler(app)

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/projects', async (c) => {
  const fileType = parseFileTypeFilter(c.req.query('fileType'))
  const projects = await discoverProjects()
  return c.json({ data: filterProjects(projects, fileType) })
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

  const resolved = docResolver.resolve(project, docPath)

  let html: string
  try {
    html = await renderFile(resolved)
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
    throw new VibedocsError('io', 'Failed to render document', { cause: err })
  }
  const toc = extractToc(html)
  return c.json({ data: { html, toc } })
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

app.post('/api/upload/:project/*', async (c) => {
  const project = c.req.param('project')
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/upload/${encodeURIComponent(project)}/`
  const folderPath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  const targetDir = assetResolver.resolve(project, folderPath)

  let s: Awaited<ReturnType<typeof fsStat>>
  try {
    s = await fsStat(targetDir)
  } catch (err) {
    throw new VibedocsError('not-found', 'Target folder not found', { cause: err })
  }
  if (!s.isDirectory()) {
    throw new VibedocsError('invalid', 'Target is not a directory')
  }

  const body = await c.req.parseBody({ all: true })
  const files = body['files']
  if (!files) {
    return c.json({ error: 'No files provided' }, 400)
  }

  const fileList = Array.isArray(files) ? files : [files]
  const uploaded = fileList.filter((f): f is File => f instanceof File)
  if (uploaded.length === 0) {
    return c.json({ error: 'No files provided' }, 400)
  }

  const results: Awaited<ReturnType<typeof safeWriteFile>>[] = []
  for (const file of uploaded) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await safeWriteFile(targetDir, file.name, buffer)
    results.push(result)
  }
  // Trigger sidebar refresh for all clients
  broadcast(refreshTreeMessage())
  return c.json({ data: results })
})

app.get('/api/file/:project/*', async (c) => {
  const project = c.req.param('project')
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/file/${encodeURIComponent(project)}/`
  const filePath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  if (!project || !filePath) {
    return c.json({ error: 'Missing project or path' }, 400)
  }

  const resolved = assetResolver.resolve(project, filePath)

  try {
    const content = await readFile(resolved)
    const ext = path.extname(resolved).toLowerCase()
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    })
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
    throw new VibedocsError('io', 'Failed to read file', { cause: err })
  }
})

// ── Content types ─────────────────────────────────────────────────────────────

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

// Attach WebSocket server to the same HTTP server
const wss = new WebSocketServer({ server: server as unknown as Server })

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

function isMarkdown(filePath: string): boolean {
  return filePath.endsWith('.md') || filePath.endsWith('.markdown')
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
    console.log(`  ↺  changed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    if (isMarkdown(filePath)) {
      broadcast(reloadMessage(filePath))
      rebuildSearchIndex()
    } else {
      broadcast(refreshTreeMessage())
    }
  })
  .on('add', (filePath: string) => {
    console.log(`  +  added:   ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast(refreshTreeMessage())
    if (isMarkdown(filePath)) {
      rebuildSearchIndex()
    }
  })
  .on('unlink', (filePath: string) => {
    console.log(`  -  removed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast(refreshTreeMessage())
    if (isMarkdown(filePath)) {
      rebuildSearchIndex()
    }
  })
  .on('addDir', (dirPath: string) => {
    console.log(`  +  dir:     ${dirPath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast(refreshTreeMessage())
  })
  .on('unlinkDir', (dirPath: string) => {
    console.log(`  -  dir:     ${dirPath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast(refreshTreeMessage())
  })

// Build initial search index
rebuildSearchIndex()
