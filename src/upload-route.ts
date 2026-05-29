import type { Hono, Context } from 'hono'
import { stat as fsStat } from 'fs/promises'
import { VibedocsError } from './errors.js'
import { safeWriteFile } from './upload.js'
import type { PathResolver } from './path-resolver.js'
import type { UploadAuthConfig } from './upload-auth.js'
import { runPipelinePhase, type UploadError } from './upload-pipeline.js'
import { resolveProjectPath } from './route-path.js'

/**
 * Turn an UploadError into a Hono response. Single point of HTTP translation
 * so route handlers don't have to know how to render each error shape.
 */
function respondWithUploadError(c: Context, err: UploadError) {
  if (err.bodyType === 'text') return c.text(err.message, err.status)
  return c.json({ error: err.message }, err.status)
}

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
    // ── Phase 1: auth gates (no body parse yet) ──────────────────────────────
    //
    // Run the 'auth' phase before touching the request body. Unauthenticated
    // requests get rejected without paying for multipart parsing. The gate
    // ordering (read-only → no-token-configured → unauthorized) lives in
    // src/upload-pipeline.ts; reordering there breaks the structural
    // ordering test in tests/upload-pipeline.test.ts.
    const authPhase = runPipelinePhase('auth', {
      authCfg,
      authorizationHeader: c.req.header('Authorization'),
      files: [],
    })
    if (authPhase.kind === 'reject') {
      return respondWithUploadError(c, authPhase.error)
    }

    // ── Resolve target directory (path traversal defense) ────────────────────
    // Single seam — see src/route-path.ts. `allowEmptyPath: true` preserves
    // the pre-helper upload behavior of accepting `/api/upload/myproject/` as
    // "upload to project root" rather than 400-ing it.
    const { safePath: targetDir } = resolveProjectPath(
      c,
      '/api/upload',
      assetResolver,
      { allowEmptyPath: true },
    )

    let s: Awaited<ReturnType<typeof fsStat>>
    try {
      s = await fsStat(targetDir)
    } catch (err) {
      throw new VibedocsError('not-found', 'Target folder not found', { cause: err })
    }
    if (!s.isDirectory()) {
      throw new VibedocsError('invalid', 'Target is not a directory')
    }

    // ── Parse body (now that auth has passed) ────────────────────────────────
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

    // ── Phase 2: content gates (extension allowlist, size cap) ───────────────
    const contentPhase = runPipelinePhase('content', {
      authCfg,
      authorizationHeader: c.req.header('Authorization'),
      files: uploaded,
    })
    if (contentPhase.kind === 'reject') {
      return respondWithUploadError(c, contentPhase.error)
    }

    // ── Write ────────────────────────────────────────────────────────────────
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
