/**
 * WebSocket origin verification.
 *
 * Browsers do NOT enforce same-origin policy on WebSocket handshakes — any
 * page the operator visits can open a WS connection to vibedocs and observe
 * broadcasts. We reject cross-origin handshakes at the upgrade step.
 *
 * The allowlist:
 *   - defaults to http://localhost:8080 (this server) and http://localhost:5173
 *     (Vite dev server), so local dev works out of the box;
 *   - is extended with http://localhost:${PORT} when PORT differs from 8080;
 *   - is extended with whatever entries appear in VIBEDOCS_WS_ALLOWED_ORIGINS
 *     (comma-separated). Operators exposing vibedocs on a tailnet hostname or
 *     similar should add it there.
 *
 * Requests with no Origin header (non-browser clients like wscat, curl) are
 * rejected by default, since the threat model is browser-driven CSWSH. Setting
 * VIBEDOCS_WS_ALLOW_NO_ORIGIN=true re-enables them for local debugging.
 */

import type { VerifyClientCallbackSync } from 'ws'

export interface ParseAllowedOriginsArgs {
  envValue: string | undefined
  port: number
}

export function parseAllowedOrigins({ envValue, port }: ParseAllowedOriginsArgs): string[] {
  const defaults = [
    'http://localhost:8080',
    'http://localhost:5173',
    `http://localhost:${port}`,
  ]

  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // Deduplicate while preserving order (env entries first so operator intent
  // wins when we ever want to expose ordering).
  return Array.from(new Set([...fromEnv, ...defaults]))
}

export interface IsOriginAllowedOpts {
  allowNoOrigin: boolean
}

export function isOriginAllowed(
  origin: string | undefined,
  allowlist: readonly string[],
  { allowNoOrigin }: IsOriginAllowedOpts,
): boolean {
  if (origin === undefined || origin === '') return allowNoOrigin

  // Browsers normally lowercase scheme + host already, but be defensive:
  // compare on a normalized lowercase form so an operator-supplied
  // mixed-case origin in the allowlist still matches.
  const norm = origin.toLowerCase()
  return allowlist.some((allowed) => allowed.toLowerCase() === norm)
}

export interface BuildVerifyClientArgs {
  allowedOrigins: readonly string[]
  allowNoOrigin: boolean
}

/**
 * Build a `verifyClient` callback for `new WebSocketServer({ verifyClient })`.
 *
 * `ws` calls this synchronously during the HTTP upgrade. Returning false
 * causes `ws` to respond 401 and abort the upgrade before any WS frame is
 * sent — so the attacker page never gets a connection to listen on.
 */
export function buildVerifyClient(args: BuildVerifyClientArgs): VerifyClientCallbackSync {
  const { allowedOrigins, allowNoOrigin } = args
  return ({ origin }) => isOriginAllowed(origin, allowedOrigins, { allowNoOrigin })
}
