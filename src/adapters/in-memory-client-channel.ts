import type { WsMessage } from '../shared/ws-messages.js'
import type { ClientChannel } from '../ports/client-channel.js'

/**
 * Test adapter — records every broadcast on `sent[]` instead of fan-out over
 * sockets. Tests assert on `sent` to verify AppState's broadcast behaviour.
 */

export interface InMemoryClientChannel extends ClientChannel {
  /** Every message broadcast through this channel, in order. */
  readonly sent: ReadonlyArray<WsMessage>
}

export function createInMemoryClientChannel(): InMemoryClientChannel {
  const sent: WsMessage[] = []
  let closed = false

  return {
    get sent() {
      return sent
    },
    broadcast(message) {
      if (closed) return
      sent.push(message)
    },
    async close() {
      closed = true
    },
  }
}
