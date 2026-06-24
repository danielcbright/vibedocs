import { Hono } from 'hono'
import { readFile, access } from 'fs/promises'
import path from 'path'

/**
 * Production static-file serving for the bundled SPA.
 *
 * Two routes: `/assets/*` returns the file under FRONTEND_DIST or 404; the
 * catch-all `*` tries the exact file first (so `/favicon.ico` etc. resolve)
 * and falls back to `index.html` (SPA hash routing). The content-type map
 * here is for the bundled SPA — uploaded user content goes through
 * src/server-routes.ts's stricter ASSET_CONTENT_TYPES (no .html, no .svg).
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

async function serveStatic(filePath: string): Promise<Response | null> {
  try {
    await access(filePath)
    const content = await readFile(filePath)
    const ext = path.extname(filePath)
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    return new Response(content, { headers: { 'Content-Type': contentType } })
  } catch {
    return null
  }
}

export function registerStaticRoutes(app: Hono, frontendDist: string): void {
  app.get('/assets/*', async (c) => {
    const r = await serveStatic(path.join(frontendDist, new URL(c.req.url).pathname))
    return r ?? c.text('Not found', 404)
  })

  app.get('*', async (c) => {
    const urlPath = new URL(c.req.url).pathname
    const exact = await serveStatic(path.join(frontendDist, urlPath))
    if (exact) return exact
    const index = await serveStatic(path.join(frontendDist, 'index.html'))
    return index ?? c.text('Not found - run "npm run build" to build the frontend', 404)
  })
}
