import type { Hono } from 'hono'
import { stat as fsStat } from 'fs/promises'
import { VibedocsError } from './errors.js'
import { safeWriteFile } from './upload.js'
import type { PathResolver } from './path-resolver.js'
import {
  checkUploadAuth,
  checkExtensionAllowed,
  type UploadAuthConfig,
} from './upload-auth.js'

// ── /api/config ──────────────────────────────────────────────────────────────
//
// Tiny endpoint the frontend reads on mount to know whether to show upload
// affordances. Intentionally minimal — no token leaked, no settings exposed.
// uploadEnabled === !readOnly && tokenConfigured.

export function registerConfigRoute(app: Hono, cfg: UploadAuthConfig): void {
  app.get('/api/config', (c) => {
    const uploadEnabled = !cfg.readOnly && cfg.token !== null
    return c.json({ uploadEnabled })
  })
}

// ── POST /api/upload/:project/* ──────────────────────────────────────────────
//
// Composition (matches issue spec):
//   read-only           → 404 (endpoint pretends not to exist)
//   no token configured → 404 (same)
//   wrong token         → 401
//   denied extension    → 400 (all-or-nothing across the batch)
//   per-file too big    → 413
//   path traversal      → 400 (via PathResolver)
//   missing folder      → 404
//   no files in body    → 400
//   success             → 200 { data: WriteResult[] }

export function registerUploadRoute(
  app: Hono,
  assetResolver: PathResolver,
  authCfg: UploadAuthConfig,
  onUploadSuccess: () => void,
): void {
  app.post('/api/upload/:project/*', async (c) => {
    // ── 1. Auth gates first (cheapest, no body parse) ────────────────────────
    const auth = checkUploadAuth(authCfg, c.req.header('Authorization'))
    if (auth === 'read-only' || auth === 'no-token-configured') {
      // Pretend the endpoint doesn't exist — don't reveal it to scanners.
      return c.text('Not Found', 404)
    }
    if (auth === 'unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // ── 2. Resolve target directory (path traversal defense) ─────────────────
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

    // ── 3. Parse body ────────────────────────────────────────────────────────
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

    // ── 4. Extension allowlist (all-or-nothing) ──────────────────────────────
    for (const file of uploaded) {
      if (!checkExtensionAllowed(file.name)) {
        return c.json(
          { error: `File extension not allowed: "${file.name}"` },
          400,
        )
      }
    }

    // ── 5. Per-file size cap ─────────────────────────────────────────────────
    for (const file of uploaded) {
      if (file.size > authCfg.maxBytes) {
        return c.json(
          {
            error: `File "${file.name}" exceeds maximum size of ${authCfg.maxBytes} bytes`,
          },
          413,
        )
      }
    }

    // ── 6. Write ─────────────────────────────────────────────────────────────
    const results: Awaited<ReturnType<typeof safeWriteFile>>[] = []
    for (const file of uploaded) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await safeWriteFile(targetDir, file.name, buffer)
      results.push(result)
    }

    onUploadSuccess()
    return c.json({ data: results })
  })
}
