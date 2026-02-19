import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import chokidar from 'chokidar'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server } from 'net'
import { discoverProjects, resolveDocPath, PROJECTS_DIR } from './discovery.js'
import { renderFile, extractToc } from './markdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PORT = 8080

const app = new Hono()

// ── Static files ──────────────────────────────────────────────────────────────

async function serveFile(filePath: string, contentType: string) {
  try {
    const content = await readFile(filePath)
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

app.get('/', () => serveFile(path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8'))
app.get('/style.css', () => serveFile(path.join(PUBLIC_DIR, 'style.css'), 'text/css'))
app.get('/app.js', () => serveFile(path.join(PUBLIC_DIR, 'app.js'), 'application/javascript'))

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

// ── Server + WebSocket ────────────────────────────────────────────────────────

const server = serve(
  { fetch: app.fetch, port: PORT },
  () => {
    console.log(`\n📚 Docs Browser running at http://localhost:${PORT}\n`)
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
    ignored: ['**/node_modules/**', '**/.git/**', '**/docs-browser/**'],
  })
  .on('change', (filePath: string) => {
    console.log(`  ↺  changed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'reload', path: filePath })
  })
  .on('add', (filePath: string) => {
    console.log(`  +  added:   ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'refresh-tree' })
  })
  .on('unlink', (filePath: string) => {
    console.log(`  -  removed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
    broadcast({ type: 'refresh-tree' })
  })
