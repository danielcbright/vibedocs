import {
  checkUploadAuth,
  checkExtensionAllowed,
  type UploadAuthConfig,
} from './upload-auth.js'

// ── Upload-route validation pipeline ─────────────────────────────────────────
//
// Security-critical gate sequence for POST /api/upload/:project/*. Each gate
// is a pure function over UploadGateContext returning a typed GateResult.
//
// The pipeline is an ordered tuple — UPLOAD_GATES. The array order IS the
// security ordering. Reordering it in source breaks the
// "UPLOAD_GATES ordering invariant" test in tests/upload-pipeline.test.ts.
//
// Order (matches the table in CLAUDE.md "Upload route gate ordering"):
//
//   1. readOnlyGate          → 404 (text)  read-only beats everything
//   2. tokenConfiguredGate   → 404 (text)  hide endpoint when uploads disabled
//   3. authorizedGate        → 401 (json)  token mismatch
//   4. extensionGate         → 400 (json)  denied extension (all-or-nothing)
//   5. sizeGate              → 413 (json)  per-file size cap exceeded
//
// A 6th outcome — success — is just "every gate passed"; the route handler
// continues with the write step. Gate ordering, status codes, and body type
// are part of the public contract: tests in tests/upload-route.test.ts and
// tests/upload-pipeline.test.ts will fail if any of these change.

export interface UploadGateContext {
  readonly authCfg: UploadAuthConfig
  readonly authorizationHeader: string | undefined
  readonly files: readonly File[]
}

export interface UploadError {
  readonly status: 400 | 401 | 404 | 413
  // 'text' → respond with `c.text(message, status)` (used for the 404s that
  // pretend the endpoint doesn't exist). 'json' → `c.json({ error: message }, status)`.
  readonly bodyType: 'text' | 'json'
  readonly message: string
}

export type GateResult =
  | { kind: 'pass' }
  | { kind: 'reject'; error: UploadError }

export type UploadGate = ((ctx: UploadGateContext) => GateResult) & {
  // 'auth' gates can be evaluated before the request body is parsed (they
  // read only the auth config + header). 'content' gates need the parsed
  // file list. Splitting into phases lets the HTTP handler short-circuit
  // unauthenticated requests without paying for body parsing — preserving
  // the pre-refactor behavior where 404/401 are returned cheaply.
  readonly phase: 'auth' | 'content'
}

function defineGate(
  phase: 'auth' | 'content',
  name: string,
  fn: (ctx: UploadGateContext) => GateResult,
): UploadGate {
  // Pin .name explicitly so UPLOAD_GATES.map(g => g.name) stays stable
  // regardless of how the function literal was declared (const arrow
  // expressions inherit no name when assigned through casts).
  Object.defineProperty(fn, 'name', { value: name, configurable: true })
  const gate = fn as UploadGate
  ;(gate as { phase: 'auth' | 'content' }).phase = phase
  return gate
}

const PASS: GateResult = { kind: 'pass' }

// ── Gate 1: read-only ────────────────────────────────────────────────────────

export const readOnlyGate: UploadGate = defineGate('auth', 'readOnlyGate', (ctx) => {
  if (ctx.authCfg.readOnly) {
    return {
      kind: 'reject',
      error: { status: 404, bodyType: 'text', message: 'Not Found' },
    }
  }
  return PASS
})

// ── Gate 2: no token configured (hide endpoint) ──────────────────────────────

export const tokenConfiguredGate: UploadGate = defineGate('auth', 'tokenConfiguredGate', (ctx) => {
  if (ctx.authCfg.token === null) {
    return {
      kind: 'reject',
      error: { status: 404, bodyType: 'text', message: 'Not Found' },
    }
  }
  return PASS
})

// ── Gate 3: token match ──────────────────────────────────────────────────────

export const authorizedGate: UploadGate = defineGate('auth', 'authorizedGate', (ctx) => {
  // Defer to the existing checkUploadAuth pure function so the token
  // comparison stays in one place (constant-time, whitespace-tolerant).
  const auth = checkUploadAuth(ctx.authCfg, ctx.authorizationHeader)
  // By the time this gate runs in the composed pipeline, readOnly and
  // null-token have already been rejected, so 'read-only' and
  // 'no-token-configured' shouldn't surface here. Treating either as a
  // 401 would be a quiet downgrade, so we collapse them onto 'unauthorized'
  // defensively — the standalone gate tests don't exercise this, but if a
  // future refactor wires this gate up out of order, we still don't leak.
  if (auth === 'ok') return PASS
  return {
    kind: 'reject',
    error: { status: 401, bodyType: 'json', message: 'Unauthorized' },
  }
})

// ── Gate 4: extension allowlist (all-or-nothing across batch) ────────────────

export const extensionGate: UploadGate = defineGate('content', 'extensionGate', (ctx) => {
  for (const file of ctx.files) {
    if (!checkExtensionAllowed(file.name)) {
      return {
        kind: 'reject',
        error: {
          status: 400,
          bodyType: 'json',
          message: `File extension not allowed: "${file.name}"`,
        },
      }
    }
  }
  return PASS
})

// ── Gate 5: per-file size cap ────────────────────────────────────────────────

export const sizeGate: UploadGate = defineGate('content', 'sizeGate', (ctx) => {
  const cap = ctx.authCfg.maxBytes
  for (const file of ctx.files) {
    if (file.size > cap) {
      return {
        kind: 'reject',
        error: {
          status: 413,
          bodyType: 'json',
          message: `File "${file.name}" exceeds maximum size of ${cap} bytes`,
        },
      }
    }
  }
  return PASS
})

// ── Ordered pipeline (security-critical invariant) ───────────────────────────
//
// The order below is part of the threat model. Do not reorder without
// updating the "UPLOAD_GATES ordering invariant" test AND the
// "Upload route gate ordering" table in CLAUDE.md.

export const UPLOAD_GATES: readonly UploadGate[] = [
  readOnlyGate,
  tokenConfiguredGate,
  authorizedGate,
  extensionGate,
  sizeGate,
]

/**
 * Runs the entire upload pipeline against `ctx`. Returns the first reject;
 * otherwise 'pass'. Primarily used by tests; production callers prefer
 * runPipelinePhase so they can defer body parsing until after auth gates pass.
 */
export function runUploadPipeline(ctx: UploadGateContext): GateResult {
  for (const gate of UPLOAD_GATES) {
    const result = gate(ctx)
    if (result.kind === 'reject') return result
  }
  return PASS
}

/**
 * Runs only the gates of a given phase, in the order they appear in
 * UPLOAD_GATES. The HTTP handler runs the 'auth' phase before parsing the
 * request body (so unauthenticated requests don't pay for body parsing),
 * then the 'content' phase after.
 *
 * Phase invariant: every auth gate appears before every content gate in
 * UPLOAD_GATES (enforced by the "UPLOAD_GATES phase invariant" test). This
 * guarantees that runPipelinePhase('auth', ...) then runPipelinePhase
 * ('content', ...) is observationally equivalent to runUploadPipeline.
 */
export function runPipelinePhase(
  phase: 'auth' | 'content',
  ctx: UploadGateContext,
): GateResult {
  for (const gate of UPLOAD_GATES) {
    if (gate.phase !== phase) continue
    const result = gate(ctx)
    if (result.kind === 'reject') return result
  }
  return PASS
}
