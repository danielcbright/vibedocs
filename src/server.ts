import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import type { Server } from 'net'
import { getConnInfo } from '@hono/node-server/conninfo'
import { PROJECT_ROOTS, PROJECT_ROOTS_ERROR, PROJECT_ROOTS_NOTES } from './discovery.js'
import { registerSearchRoute, registerFileRoute, registerProjectTreeRoute } from './server-routes.js'
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
import { registerAgentRunsRoutes } from './agent-runs/routes.js'
import { registerOpenRoute } from './open-route.js'
import { registerSettingsRoutes } from './settings/routes.js'
import { parseSettingsConfig } from './settings/auth.js'
import { rootsSource } from './project-roots.js'

// A root configuration that cannot work stops the server here, with the reason.
// Booting anyway would serve an empty or double-counted set of projects and look
// like a discovery bug.
if (PROJECT_ROOTS_ERROR !== null) {
  console.error(`\n✖ VibeDocs cannot start: ${PROJECT_ROOTS_ERROR}\n`)
  process.exit(1)
}
for (const note of PROJECT_ROOTS_NOTES) console.warn(`  ⚠ ${note}`)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
const PORT = parseInt(process.env.VIBEDOCS_PORT || process.env.PORT || '8080', 10)

// Path resolvers are stateless allocations — module-level, NOT inside AppState.
// docResolver locks markdown-only routes; assetResolver permits any file type.
const docResolver = new PathResolver({ roots: PROJECT_ROOTS, requireExtensions: MARKDOWN_EXTENSIONS })
const assetResolver = new PathResolver({ roots: PROJECT_ROOTS })

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
const settings = parseSettingsConfig(process.env, state.uploadAuth.readOnly)
registerConfigRoute(app, state.uploadAuth, state.agentRuns.cfg.enabled, settings.enabled)
registerUploadRoute(app, assetResolver, state.uploadAuth, () => state.broadcast(refreshTreeMessage()))
registerFileRoute(app, assetResolver)
registerProjectTreeRoute(app, { assetResolver, isHidden: (dir) => state.visibility.isHidden(dir) })
// Must precede registerStaticRoutes too — see the MUST note below.
registerOpenRoute(app, { roots: PROJECT_ROOTS, docResolver })

// Roots picker (Settings view). A saved change takes effect on restart, because
// PROJECT_ROOTS is a module-load snapshot: under a supervisor the server exits and
// is started again on the new roots; otherwise the page says to restart it.
const source = rootsSource(process.env)
registerSettingsRoutes(app, {
  enabled: settings.enabled,
  port: () => PORT,
  peerAddress: (c) => getConnInfo(c).remote.address,
  home: os.homedir(),
  roots: PROJECT_ROOTS,
  source,
  rootsFile: source.kind === 'file' ? path.resolve(process.cwd(), source.file) : null,
  afterSave: settings.supervised ? 'restart' : 'manual',
  onSaved: () => {
    if (!settings.supervised) return
    console.log('  ↻ Roots saved — exiting so the supervisor restarts on them')
    // Let the response flush first. 75 (EX_TEMPFAIL) rather than 0 so a systemd
    // unit with Restart=on-failure restarts too; launchd KeepAlive restarts on any exit.
    // Shutdown is capped: an open browser socket keeps it pending indefinitely, and
    // a restart that waits on it never happens.
    setTimeout(() => {
      const capped = new Promise((resolve) => setTimeout(resolve, 2000).unref())
      void Promise.race([state.shutdown(), capped]).finally(() => process.exit(75))
    }, 250)
  },
})

// Origin allowlist is needed BEFORE route registration (the control-write gate
// uses it) and again after boot for the WS handshake. It only reads env + PORT,
// so computing it here is safe.
const allowedOrigins = parseAllowedOrigins({ envValue: process.env.VIBEDOCS_WS_ALLOWED_ORIGINS, port: PORT })
const allowNoOrigin = process.env.VIBEDOCS_WS_ALLOW_NO_ORIGIN === 'true'

// MUST precede registerStaticRoutes: the SPA fallback answers ANY unmatched
// path with 200 text/html, so routes registered after it are never reached —
// and the failure looks like success to a client checking res.ok.
registerAgentRunsRoutes(app, {
  cfg: state.agentRuns.cfg,
  clientConfig: state.agentRuns.clientConfig,
  store: state.agentRuns.store,
  ingest: state.agentRuns.ingest,
  renderer: state.agentRuns.renderer,
  allowedOrigins,
})

registerStaticRoutes(app, FRONTEND_DIST)

// ── HTTP + WebSocket boot ─────────────────────────────────────────────────────
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n📚 VibeDocs running at http://localhost:${PORT}\n`)
})

// Wire the real ws fan-out (CSWSH defense at the HTTP-upgrade step via the
// Origin allowlist — see src/ws-auth.ts). Pre-swap broadcasts route through
// runLive's placeholder in-memory channel.
console.log(`  📁 Roots (${state.roots.length}): ${state.roots.join(', ')}`)
if (state.hiddenProjects.length > 0) {
  const worktrees = state.hiddenProjects.filter((h) => h.reason === 'worktree').length
  console.log(`  🙈 Hidden projects: ${state.hiddenProjects.length} (${worktrees} git worktrees) — not listed, watched or searched; still open by path`)
}
console.log(`  🔒 WS origin allowlist: ${allowedOrigins.join(', ')}`)
if (allowNoOrigin) console.log('  🔒 WS allows handshakes with no Origin header')
const upMode = state.uploadAuth.readOnly ? 'READ-ONLY' : state.uploadAuth.token === null ? 'DISABLED' : 'TOKEN'
console.log(`  🔒 Upload mode: ${upMode}`)
const runsMode = !state.agentRuns.cfg.enabled
  ? 'DISABLED'
  : state.agentRuns.cfg.token === null
    ? 'READ-ONLY (no ingest token)'
    : 'ENABLED'
console.log(`  🔒 Agent runs: ${runsMode}  (${state.agentRuns.cfg.runsDir})`)
console.log(`  🔒 Settings: ${!settings.enabled ? 'DISABLED' : source.kind === 'file' ? 'ENABLED (this machine only)' : 'READ-ONLY (roots not from a file)'}`)
state.setClientChannel(createWsClientChannel({
  server: server as unknown as Server,
  verifyClient: buildVerifyClient({ allowedOrigins, allowNoOrigin }),
}))
