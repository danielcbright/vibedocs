/**
 * Agent Runs authorization — two paths, two threat models.
 *
 *   INGEST   POST /api/runs, POST /api/runs/:id/events, POST .../ack
 *            A dispatch client, possibly not on this machine, holding a shared
 *            secret. Bearer token, same policy shape as uploads.
 *
 *   CONTROL  PATCH /api/runs/:id, POST /api/runs/:id/commands
 *            Two callers, either credential accepted. The browser UI (Stop, mark
 *            merged, mark failed) has no secret and must never be given one —
 *            handing the ingest token to the page would put it in devtools and in
 *            every page load — so it proves same-origin, reusing the WS Origin
 *            allowlist as the CSRF boundary. A machine client reporting its own
 *            run lifecycle has no origin, so it may present the ingest token
 *            instead. See checkRunsControlAuth for why that is safe.
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
  | 'forbidden' // neither credential satisfied (403)
  | 'ok'

export interface RunsControlAuthInput {
  /** Feature switch plus the ingest token, if one is configured. */
  cfg: Pick<AgentRunsEnvConfig, 'enabled' | 'token'>
  /** The request's `Origin` header, if any. */
  origin: string | undefined
  allowedOrigins: readonly string[]
  /** The request's `Authorization` header, if any. */
  authorization: string | undefined
}

/**
 * Control writes accept EITHER credential, because two legitimate callers need
 * this route and neither can present the other's proof:
 *
 * - **The browser** holds no secret and must never be given one, so it proves
 *   same-origin instead. That check is the CSRF boundary.
 * - **A machine client** reporting its own run lifecycle has no origin to offer.
 *   Forcing it to send one would have it assert browser-ness it doesn't have,
 *   and would hollow out the very signal the origin check exists to read.
 *
 * Letting the ingest token authorise a status write is a smaller increment than
 * it looks: a client that can append arbitrary events to a run's log can already
 * fabricate the entire transcript, and it is the authority on whether its own
 * turn succeeded.
 *
 * `allowNoOrigin` stays false and non-configurable. A missing Origin still fails
 * the origin door — it just no longer ends the request, because the token door
 * is now open to exactly the non-browser clients that absence identifies.
 *
 * Ordering note: `disabled` is checked first so a switched-off server reveals
 * nothing about whether a token happens to be configured.
 *
 * On failure this returns `forbidden` (403) rather than borrowing ingest's
 * 404-when-no-token-configured behaviour. That anti-fingerprinting matters on
 * ingest, where the endpoint is the only evidence the feature exists; here it
 * buys nothing, because reads are open on loopback and already disclose both the
 * route and the run.
 */
export function checkRunsControlAuth(input: RunsControlAuthInput): RunsControlAuthResult {
  const { cfg, origin, allowedOrigins, authorization } = input
  if (!cfg.enabled) return 'disabled'

  // Either door suffices. Token first: it is a constant-time comparison against
  // a configured secret, and it is the path a machine client is expected to use.
  if (cfg.token !== null && checkBearerToken(cfg.token, authorization)) return 'ok'
  if (isOriginAllowed(origin, allowedOrigins, { allowNoOrigin: false })) return 'ok'
  return 'forbidden'
}
