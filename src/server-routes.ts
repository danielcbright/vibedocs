import type { Hono } from 'hono'
import { readFile, stat } from 'fs/promises'
import { randomBytes } from 'crypto'
import path from 'path'
import type { SearchResult } from './search.js'
import type { PathResolver } from './path-resolver.js'
import { VibedocsError } from './errors.js'
import { resolveProjectPath } from './route-path.js'
import {
  buildTreePublic,
  filterTreeByType,
  parseFileTypeFilter,
  type FileTypeFilter,
  type ProjectInfo,
} from './discovery.js'

/**
 * Minimal contract the search route needs from its data source — a search
 * function and a version counter. Both `IndexStore` (direct legacy wiring,
 * still used by `tests/search-route.test.ts`) and `AppState` (new live-mode
 * orchestrator that exposes `searchVersion`) satisfy this shape via an
 * adapter object in server.ts.
 */
export interface SearchEndpoint {
  search(query: string, maxResults?: number): SearchResult[]
  readonly version: number
}

export function registerSearchRoute(app: Hono, store: SearchEndpoint): void {
  app.get('/api/search', (c) => {
    const q = c.req.query('q') || ''
    if (q.trim().length < 2) {
      return c.json({ data: [], version: store.version })
    }
    const results = store.search(q)
    return c.json({ data: results, version: store.version })
  })
}

// ── /api/file/* security policy ──────────────────────────────────────────────
//
// Threat model: any uploaded file is served back from the same origin as the
// vibedocs SPA. That means executable formats (HTML, SVG with <script>) would
// run inside vibedocs's origin and inherit access to every API. See issue #34.
//
// Defenses applied here:
//
//   1. ASSET_CONTENT_TYPES intentionally OMITS .html and .svg — they fall
//      through to application/octet-stream so the browser does not render
//      them as documents. The static-file map in server.ts (for /assets/*)
//      is separate and still serves the bundled SPA HTML correctly.
//
//   2. X-Content-Type-Options: nosniff on every response — prevents browser
//      content-sniffing from overriding our Content-Type (e.g. inferring
//      text/html from a file that happens to start with "<!DOCTYPE html>").
//
//   3. Content-Disposition: inline only for the small allowlist of formats
//      that cannot execute script (raster image types). Everything else
//      gets attachment so the browser downloads rather than renders.

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Extensions safe to serve inline (cannot execute script in a browser).
// Everything else gets Content-Disposition: attachment.
const SAFE_INLINE_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
])

/**
 * Encode a filename for Content-Disposition's `filename=` parameter.
 * Strips quotes and control chars; non-ASCII falls back to RFC 5987 filename*.
 */
function dispositionFilename(name: string): string {
  // Drop anything but the basename (defensive — should already be the case).
  const base = path.basename(name)
  // Quoted ASCII-safe fallback.
  const ascii = base.replace(/["\\\r\n]/g, '_')
  const asciiOnly = /^[\x20-\x7e]*$/.test(ascii)
  if (asciiOnly) {
    return `filename="${ascii}"`
  }
  // RFC 5987 for non-ASCII names.
  return `filename="${ascii.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(base)}`
}

export function registerFileRoute(app: Hono, assetResolver: PathResolver): void {
  app.get('/api/file/:project/*', async (c) => {
    // Single seam — see src/route-path.ts.
    const { safePath } = resolveProjectPath(c, '/api/file', assetResolver)

    try {
      const content = await readFile(safePath)
      const ext = path.extname(safePath).toLowerCase()
      const contentType = ASSET_CONTENT_TYPES[ext] || 'application/octet-stream'
      const disposition = SAFE_INLINE_EXTENSIONS.has(ext) ? 'inline' : 'attachment'
      const filename = dispositionFilename(path.basename(safePath))

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `${disposition}; ${filename}`,
        },
      })
    } catch (err: any) {
      if (err?.code === 'ENOENT') throw new VibedocsError('not-found', 'File not found', { cause: err })
      throw new VibedocsError('io', 'Failed to read file', { cause: err })
    }
  })
}

/**
 * `GET /api/projects/:project/tree` — one project's tree, hidden or not.
 *
 * `/api/projects` leaves hidden projects out (ADR-0003), but a doc in one can still
 * be opened by path, and the sidebar then needs that project's tree to show where
 * you are. The project is located through the asset resolver, so it is exactly as
 * reachable as its files are: any project in a root, never a dot or excluded one.
 */
export function registerProjectTreeRoute(
  app: Hono,
  deps: { assetResolver: PathResolver; isHidden: (projectDir: string) => boolean },
): void {
  app.get('/api/projects/:project/tree', async (c) => {
    const project = c.req.param('project')
    const dir = deps.assetResolver.resolve(project, '')
    try {
      if (!(await stat(dir)).isDirectory()) throw new Error('not a directory')
    } catch (err) {
      throw new VibedocsError('not-found', `Project not found: ${project}`, { cause: err })
    }
    let hasDocsFolder = false
    try {
      hasDocsFolder = (await stat(path.join(dir, 'docs'))).isDirectory()
    } catch {}
    const tree = filterTreeByType(await buildTreePublic(dir, dir), parseFileTypeFilter(c.req.query('fileType')))
    const data: ProjectInfo & { hidden: boolean } = { name: project, hasDocsFolder, tree, hidden: deps.isHidden(dir) }
    return c.json({ data })
  })
}

export interface ProjectsEndpoint {
  /** The project-tree version right now; cheap. */
  version(): number
  /** The list for one file type, with the version it is at. */
  listVersioned(fileType: FileTypeFilter): Promise<{ projects: ProjectInfo[]; version: number }>
}

/**
 * `GET /api/projects` — served from the in-memory tree (src/project-tree-cache.ts).
 *
 * The ETag is this run's id, the tree version and the file type, and `Cache-Control: no-cache`
 * makes the browser revalidate every time, so a tab that is already current gets
 * a bodiless 304 without the server filtering or serialising anything. A changed
 * tree is serialised once per file type and shared by every tab that asks.
 */
export function registerProjectsRoute(app: Hono, deps: ProjectsEndpoint): void {
  const bodies = new Map<FileTypeFilter, { version: number; body: string }>()
  // The version restarts at 0 on every boot, and a roots change in Settings is a
  // restart — so a version alone names different lists across runs, and a browser
  // holding the old one was told 304. One id per run keeps the tags apart.
  const run = randomBytes(6).toString('base64url').toLowerCase().replace(/[^0-9a-z]/g, '') || 'run'

  app.get('/api/projects', async (c) => {
    const fileType = parseFileTypeFilter(c.req.query('fileType'))
    const etagFor = (version: number) => `"${run}-${version}-${fileType}"`
    const headers = { 'Cache-Control': 'no-cache' }

    const current = deps.version()
    if (c.req.header('if-none-match') === etagFor(current)) {
      return c.body(null, 304, { ...headers, ETag: etagFor(current) })
    }

    let hit = bodies.get(fileType)
    if (hit === undefined || hit.version !== current) {
      const { projects, version } = await deps.listVersioned(fileType)
      hit = { version, body: JSON.stringify({ data: projects, version }) }
      bodies.set(fileType, hit)
    }
    return c.body(hit.body, 200, {
      ...headers,
      ETag: etagFor(hit.version),
      'Content-Type': 'application/json; charset=utf-8',
    })
  })
}
