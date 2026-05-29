/**
 * Port: client message channel.
 *
 * Production wraps a `ws` `WebSocketServer` (broadcast = fan-out over every
 * connected socket). Tests use an in-memory adapter that records messages on a
 * `sent[]` array so AppState's broadcast behaviour can be asserted directly.
 *
 * See ADR-0001 — one of two ports kept because two real adapters exist.
 */

import type { WsMessage } from '../shared/ws-messages.js'

export interface ClientChannel {
  /** Push `message` to every currently-connected client. */
  broadcast(message: WsMessage): void
  /** Stop accepting/sending messages. Idempotent. */
  close(): Promise<void>
}
