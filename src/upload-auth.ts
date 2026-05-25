import { timingSafeEqual } from 'crypto'
import path from 'path'

// ── Upload-route authorization & validation ──────────────────────────────────
//
// Pure functions for evaluating upload-route gates: read-only mode, shared-
// secret token, extension allowlist, per-file size cap. Kept separate from
// the HTTP handler so the policy can be tested in isolation.

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

// Allowlist: extensions that are safe to upload by default. Markdown is the
// primary content type; images and PDFs are common attachments; .txt covers
// the long tail of plain-text notes.
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  '.md', '.markdown',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf',
  '.txt',
]

// Explicit deny: extensions that could execute in a browser (HTML/SVG/JS),
// or that the server already serves with active content-types. These would
// never reach the allowlist anyway, but listing them makes the policy
// explicit (and gives nicer error messages than "unknown extension").
export const DEFAULT_DENIED_EXTENSIONS: readonly string[] = [
  '.html', '.htm', '.xhtml',
  '.svg',
  '.js', '.mjs',
  '.json',
  '.css',
  '.wasm',
]

export interface UploadAuthConfig {
  readOnly: boolean
  token: string | null
  maxBytes: number
}

const TRUTHY = new Set(['true', '1', 'yes', 'on'])

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.toLowerCase().trim())
}

export function parseUploadAuthConfig(env: Record<string, string | undefined>): UploadAuthConfig {
  const tokenRaw = env.VIBEDOCS_UPLOAD_TOKEN
  const token = tokenRaw && tokenRaw.trim().length > 0 ? tokenRaw : null

  const maxRaw = env.VIBEDOCS_UPLOAD_MAX_BYTES
  let maxBytes = DEFAULT_MAX_UPLOAD_BYTES
  if (maxRaw) {
    const parsed = parseInt(maxRaw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      maxBytes = parsed
    }
  }

  return {
    readOnly: isTruthy(env.VIBEDOCS_READ_ONLY),
    token,
    maxBytes,
  }
}

export type AuthResult =
  | 'read-only'          // VIBEDOCS_READ_ONLY=true: pretend endpoint doesn't exist (404)
  | 'no-token-configured' // VIBEDOCS_UPLOAD_TOKEN unset: same (404, hides feature)
  | 'unauthorized'       // token configured, header missing or wrong (401)
  | 'ok'                 // pass

/**
 * Composition rule (matches issue ordering):
 *   read-only → no-token-configured → unauthorized → ok
 *
 * Read-only wins over token. An unconfigured server returns 404 so an
 * unauthenticated scanner can't even tell the endpoint exists.
 */
export function checkUploadAuth(
  cfg: UploadAuthConfig,
  authorizationHeader: string | undefined
): AuthResult {
  if (cfg.readOnly) return 'read-only'
  if (cfg.token === null) return 'no-token-configured'

  if (!authorizationHeader) return 'unauthorized'
  // Accept `Bearer <token>` (preferred). Whitespace tolerated.
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!match) return 'unauthorized'
  const provided = match[1].trim()

  // Constant-time comparison to defeat timing oracles. Different-length
  // strings fail fast (timingSafeEqual requires equal length).
  const expected = cfg.token
  if (provided.length !== expected.length) return 'unauthorized'
  const ok = timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  return ok ? 'ok' : 'unauthorized'
}

// ── Extension allowlist ──────────────────────────────────────────────────────

const ALLOWED_SET = new Set(DEFAULT_ALLOWED_EXTENSIONS.map((e) => e.toLowerCase()))
const DENIED_SET = new Set(DEFAULT_DENIED_EXTENSIONS.map((e) => e.toLowerCase()))

/**
 * Returns true iff `filename`'s extension is on the allowlist and not on the
 * deny list. Case-insensitive. Extensionless files are rejected.
 */
export function checkExtensionAllowed(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  if (!ext) return false
  if (DENIED_SET.has(ext)) return false
  return ALLOWED_SET.has(ext)
}
