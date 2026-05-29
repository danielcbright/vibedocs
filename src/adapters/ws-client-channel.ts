import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'net'
import type { ClientChannel } from '../ports/client-channel.js'
import type { WsMessage } from '../shared/ws-messages.js'
import type { VerifyClientCallbackSync } from 'ws'

/**
 * Production adapter — wraps a `ws` WebSocketServer.
 *
 * Tracks connected clients in a Set, fans out broadcast() to each open
 * socket as a JSON-encoded WsMessage. verifyClient enforces the Origin
 * allowlist at the HTTP-upgrade step — see src/ws-auth.ts and ADR-0001.
 *
 * Lifecycle: `close()` shuts the underlying WebSocketServer and unhooks
 * the connection listener. Idempotent — callers can shutdown freely.
 */

export interface WsClientChannelOptions {
  /** Underlying HTTP server to attach the WebSocketServer to. */
  server: Server
  /** Origin-allowlist verifier (see src/ws-auth.ts). */
  verifyClient: VerifyClientCallbackSync
}

export function createWsClientChannel(opts: WsClientChannelOptions): ClientChannel {
  // Hono's `serve()` returns a `net.Server`; `ws`'s WebSocketServer typings
  // want an `http.Server`. The runtime contract is fine — they're the same
  // object — but TS can't see through the structural mismatch. The same
  // cast lived in server.ts before this adapter existed (issue #92 ADR).
  const wss = new WebSocketServer({
    server: opts.server as unknown as Server,
    verifyClient: opts.verifyClient,
  })

  const clients = new Set<WebSocket>()
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
  })

  return {
    broadcast(message: WsMessage) {
      const data = JSON.stringify(message)
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data)
        }
      }
    },
    async close() {
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
