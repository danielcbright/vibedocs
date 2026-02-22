import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFile, access } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import chokidar from 'chokidar'
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'net'
import { discoverProjects, resolveDocPath, PROJECTS_DIR } from './discovery.js'
import { renderFile, extractToc } from './markdown.js'
import { buildSearchIndex, search } from './search.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
const PORT = parseInt(process.env.VIBEDOCS_PORT || process.env.PORT || '8080', 10)

const app = new Hono()

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/projects', async (c) => {
  try {
    const projects = await discoverProjects()
    return c.json({ data: projects })
  } catch (err) {
    console.error('Error discovering projects:', err)
    return c.json({ error: 'Failed to discover projects' }, 500)
  }
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

  const resolved = resolveDocPath(project, docPath)
  if (!resolved) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  try {
    const html = await renderFile(resolved)
    const toc = extractToc(html)
    return c.json({ data: { html, toc } })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }
    console.error('Render error:', err)
    return c.json({ error: 'Failed to render document' }, 500)
  }
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

  const resolved = resolveDocPath(project, docPath)
  if (!resolved) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  try {
    const content = await readFile(resolved, 'utf-8')
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }
    console.error('Raw file error:', err)
    return c.json({ error: 'Failed to read file' }, 500)
  }
})

app.get('/api/search', (c) => {
  const q = c.req.query('q') || ''
  if (q.trim().length < 2) {
    return c.json({ data: [] })
  }
  const results = search(q)
  return c.json({ data: results })
})

// ── Static files (production: serve frontend/dist/) ──────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

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

function broadcast(message: object) {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

// ── File watcher ──────────────────────────────────────────────────────────────

const watchGlob = path.join(PROJECTS_DIR, '**/*.md')

chokidar
  .watch(watchGlob, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/.git/**'],
  })
  .on('change', (filePath: string) => {
    console.log(`  ↺  changed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'reload', path: filePath })
    // Rebuild search index on change
    buildSearchIndex()
  })
  .on('add', (filePath: string) => {
    console.log(`  +  added:   ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'refresh-tree' })
    buildSearchIndex()
  })
  .on('unlink', (filePath: string) => {
    console.log(`  -  removed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'refresh-tree' })
    buildSearchIndex()
  })

// Build initial search index
buildSearchIndex()
