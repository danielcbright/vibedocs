/**
 * Agent Runs authorization — two paths, two threat models.
 *
 *   INGEST   POST /api/runs, POST /api/runs/:id/events, POST .../ack
 *            A dispatch client, possibly not on this machine, holding a shared
 *            secret. Bearer token, same policy shape as uploads.
 *
 *   CONTROL  PATCH /api/runs/:id, POST /api/runs/:id/commands
 *            The browser UI: Stop, mark merged, mark failed. It has no secret
 *            and must never be given one — handing the ingest token to the page
 *            would put it in devtools and in every page load. The check is
 *            same-origin instead, reusing the WS Origin allowlist, which is the
 *            CSRF boundary for these writes.
 *
 * Reads stay open on loopback.
 */

import { checkBearerToken } from '../bearer-auth.js'
import { isOriginAllowed } from '../ws-auth.js'
import type { AgentRunsEnvConfig } from './config.js'

export type RunsIngestAuthResult =
  | 'disabled'            // feature off: pretend the endpoint doesn't exist (404)
  | 'no-token-configured' // enabled but no token: same (404), don't fingerprint it
  | 'unauthorized'        // token set, header missing or wrong (401)
  | 'ok'

/**
 * Composition order mirrors the upload gate: disabled → no-token → unauthorized.
 * Checking `enabled` first means a disabled server never reveals whether a token
 * happens to be configured.
 */
export function checkRunsIngestAuth(
  cfg: Pick<AgentRunsEnvConfig, 'enabled' | 'token'>,
  authorizationHeader: string | undefined,
): RunsIngestAuthResult {
  if (!cfg.enabled) return 'disabled'
  if (cfg.token === null) return 'no-token-configured'
  return checkBearerToken(cfg.token, authorizationHeader) ? 'ok' : 'unauthorized'
}

export type RunsControlAuthResult =
  | 'disabled'  // feature off (404)
  | 'forbidden' // cross-origin or no Origin (403)
  | 'ok'

/**
 * Same-origin check for browser-initiated control writes.
 *
 * `allowNoOrigin` is deliberately false and not configurable: browsers always
 * send Origin on POST/PATCH, so a missing one means a non-browser client, and
 * those belong on the token path. (The WS handshake has its own
 * VIBEDOCS_WS_ALLOW_NO_ORIGIN escape hatch for debugging; a state-changing write
 * is not the place for one.)
 */
export function checkRunsControlAuth(
  cfg: { enabled: boolean },
  origin: string | undefined,
  allowedOrigins: readonly string[],
): RunsControlAuthResult {
  if (!cfg.enabled) return 'disabled'
  return isOriginAllowed(origin, allowedOrigins, { allowNoOrigin: false }) ? 'ok' : 'forbidden'
}
