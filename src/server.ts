import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { fileURLToPath } from 'url'
import path from 'path'
import type { Server } from 'net'
import { PROJECTS_DIR } from './discovery.js'
import { registerSearchRoute, registerFileRoute } from './server-routes.js'
import { registerUploadRoute, registerConfigRoute } from './upload-route.js'
import { PathResolver } from './path-resolver.js'
import { refreshTreeMessage } from './shared/ws-messages.js'
import { registerErrorHandler } from './errors.js'
import { parseAllowedOrigins, buildVerifyClient } from './ws-auth.js'
import { MARKDOWN_EXTENSIONS } from './markdown-paths.js'
import { resolveProjectPath } from './route-path.js'
import { runLive, readRawFile } from './app-state.js'
import { createWsClientChannel } from './adapters/ws-client-channel.js'
import { registerStaticRoutes } from './static-files.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
const PORT = parseInt(process.env.VIBEDOCS_PORT || process.env.PORT || '8080', 10)

// Path resolvers are stateless allocations — module-level, NOT inside AppState.
// docResolver locks markdown-only routes; assetResolver permits any file type.
const docResolver = new PathResolver({ projectsDir: PROJECTS_DIR, requireExtensions: MARKDOWN_EXTENSIONS })
const assetResolver = new PathResolver({ projectsDir: PROJECTS_DIR })

// AppState owns live runtime state: search index, site-config cache, chokidar
// subscription, broadcast fan-out, upload-auth snapshot. ws fan-out is wired
// at the bottom of this file, once the HTTP server is up. See src/app-state.ts.
const state = await runLive(process.env)

const app = new Hono()
registerErrorHandler(app)

app.get('/api/projects', async (c) => {
  const fileType = (c.req.query('fileType') ?? 'all') as 'all' | 'markdown' | 'assets'
  return c.json({ data: await state.listProjects(fileType) })
})

app.get('/api/render/:project/*', async (c) => {
  const { project, relativePath: docPath, safePath } = resolveProjectPath(c, '/api/render', docResolver)
  const page = await state.renderPage(safePath, project, docPath)
  return c.json({ data: { html: page.html, toc: page.toc } })
})

app.get('/api/raw/:project/*', async (c) => {
  const { safePath } = resolveProjectPath(c, '/api/raw', docResolver)
  const content = await readRawFile(safePath)
  return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
})

registerSearchRoute(app, { search: (q, n) => state.search(q, n), get version() { return state.searchVersion } })
registerConfigRoute(app, state.uploadAuth)
registerUploadRoute(app, assetResolver, state.uploadAuth, () => state.broadcast(refreshTreeMessage()))
registerFileRoute(app, assetResolver)

registerStaticRoutes(app, FRONTEND_DIST)

// ── HTTP + WebSocket boot ─────────────────────────────────────────────────────
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n📚 VibeDocs running at http://localhost:${PORT}\n`)
})

// Wire the real ws fan-out (CSWSH defense at the HTTP-upgrade step via the
// Origin allowlist — see src/ws-auth.ts). Pre-swap broadcasts route through
// runLive's placeholder in-memory channel.
const allowedOrigins = parseAllowedOrigins({ envValue: process.env.VIBEDOCS_WS_ALLOWED_ORIGINS, port: PORT })
const allowNoOrigin = process.env.VIBEDOCS_WS_ALLOW_NO_ORIGIN === 'true'
console.log(`  🔒 WS origin allowlist: ${allowedOrigins.join(', ')}`)
if (allowNoOrigin) console.log('  🔒 WS allows handshakes with no Origin header')
const upMode = state.uploadAuth.readOnly ? 'READ-ONLY' : state.uploadAuth.token === null ? 'DISABLED' : 'TOKEN'
console.log(`  🔒 Upload mode: ${upMode}`)
state.setClientChannel(createWsClientChannel({
  server: server as unknown as Server,
  verifyClient: buildVerifyClient({ allowedOrigins, allowNoOrigin }),
}))
