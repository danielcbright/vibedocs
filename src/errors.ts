import type { Hono } from 'hono'
import type { StatusCode } from 'hono/utils/http-status'

// ── Typed error hierarchy ────────────────────────────────────────────────────
//
// All filesystem-touching modules (discovery.ts, upload.ts, future PathResolver,
// etc.) throw VibedocsError instead of leaking raw Node fs errors. A single
// Hono onError hook translates the typed error to HTTP status + JSON body.

export type VibedocsErrorCode =
  | 'not-found'   // resource doesn't exist (e.g. ENOENT)            → 404
  | 'forbidden'   // permission denied (e.g. EACCES / EPERM)          → 403
  | 'traversal'   // path escapes its sandbox (defense-in-depth)      → 400
  | 'conflict'    // resource conflict (e.g. too many name conflicts) → 409
  | 'invalid'     // request precondition failed (wrong type, etc.)   → 400
  | 'io'          // generic filesystem / write failure               → 500

interface VibedocsErrorOptions {
  cause?: unknown
  details?: Record<string, unknown>
}

export class VibedocsError extends Error {
  readonly code: VibedocsErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: VibedocsErrorCode, message: string, options: VibedocsErrorOptions = {}) {
    // ES2022 Error supports `cause` via options; pass through for stack-chain visibility.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'VibedocsError'
    this.code = code
    if (options.details) this.details = options.details
  }
}

// ── HTTP translation ─────────────────────────────────────────────────────────

const CODE_TO_STATUS: Record<VibedocsErrorCode, number> = {
  'not-found': 404,
  'forbidden': 403,
  'traversal': 400,
  'conflict':  409,
  'invalid':   400,
  'io':        500,
}

export function httpStatusForCode(code: VibedocsErrorCode): number {
  return CODE_TO_STATUS[code]
}

/**
 * Single point of HTTP error translation. Registers a Hono `onError` hook that:
 *  - VibedocsError → mapped status + `{ error: err.message }`
 *  - any other Error → 500 + `{ error: 'Internal Server Error' }` (never leaks internals)
 *
 * Routes should throw VibedocsError directly and let this handler shape the response.
 */
export function registerErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof VibedocsError) {
      const status = httpStatusForCode(err.code) as StatusCode
      return c.json({ error: err.message }, status as any)
    }
    console.error('Unhandled error:', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  })
}
