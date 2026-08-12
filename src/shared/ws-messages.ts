/**
 * Shared WebSocket message protocol.
 *
 * Imported by both the Hono backend (broadcast call-sites in src/server.ts)
 * and the React frontend (frontend/src/hooks/use-websocket.ts).
 *
 * Adding a new variant to WsMessage is a one-line union extension that
 * will cause TypeScript compile errors in any unhandled call-site —
 * the frontend's exhaustive switch enforces this via the `never` check.
 */

export interface ReloadMessage {
  type: 'reload'
  path: string
}

export interface RefreshTreeMessage {
  type: 'refresh-tree'
}

export interface RunUpdatedMessage {
  type: 'run-updated'
  runId: string
}

/**
 * New records are available. Deliberately a nudge carrying a count, not the
 * payload: the client fetches ?fromRec=<its own count>, so live updates and
 * reconnect catch-up travel the same code path.
 */
export interface RunRecordsMessage {
  type: 'run-records'
  runId: string
  recCount: number
}

export type WsMessage = ReloadMessage | RefreshTreeMessage | RunUpdatedMessage | RunRecordsMessage

// ── Constructors (server-side) ────────────────────────────────────────────────

export function reloadMessage(path: string): ReloadMessage {
  return { type: 'reload', path }
}

export function refreshTreeMessage(): RefreshTreeMessage {
  return { type: 'refresh-tree' }
}

export function runUpdatedMessage(runId: string): RunUpdatedMessage {
  return { type: 'run-updated', runId }
}

export function runRecordsMessage(runId: string, recCount: number): RunRecordsMessage {
  return { type: 'run-records', runId, recCount }
}

// ── Parser (client-side) ──────────────────────────────────────────────────────

/**
 * Parses a raw wire payload into a typed WsMessage, or returns null if the
 * payload is malformed or does not match any known variant.
 *
 * The parser is the single point of trust for inbound data; everything
 * downstream gets a fully-typed WsMessage.
 */
export function parseWsMessage(raw: string): WsMessage | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return null
  }

  if (!candidate || typeof candidate !== 'object') return null
  const obj = candidate as Record<string, unknown>

  switch (obj.type) {
    case 'reload':
      return typeof obj.path === 'string'
        ? { type: 'reload', path: obj.path }
        : null
    case 'refresh-tree':
      return { type: 'refresh-tree' }
    case 'run-updated':
      return typeof obj.runId === 'string' ? { type: 'run-updated', runId: obj.runId } : null
    case 'run-records':
      return typeof obj.runId === 'string' && typeof obj.recCount === 'number'
        ? { type: 'run-records', runId: obj.runId, recCount: obj.recCount }
        : null
    default:
      return null
  }
}
