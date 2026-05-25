import type { Hono } from 'hono'
import { readFile } from 'fs/promises'
import path from 'path'
import type { IndexStore } from './search.js'
import type { PathResolver } from './path-resolver.js'
import { VibedocsError } from './errors.js'

export function registerSearchRoute(app: Hono, store: IndexStore): void {
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
      const contentType = ASSET_CONTENT_TYPES[ext] || 'application/octet-stream'
      const disposition = SAFE_INLINE_EXTENSIONS.has(ext) ? 'inline' : 'attachment'
      const filename = dispositionFilename(path.basename(resolved))

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
