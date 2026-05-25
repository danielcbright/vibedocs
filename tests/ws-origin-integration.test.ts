import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import { buildVerifyClient } from '../src/ws-auth.js'

/**
 * Integration test: stand up a real HTTP server with a WebSocketServer
 * attached, wired through buildVerifyClient, and confirm that:
 *   - a handshake with an allowed Origin completes,
 *   - a handshake with a disallowed Origin is rejected BEFORE the WS opens,
 *   - a handshake with no Origin header is rejected by default.
 *
 * We use the `ws` client (same package, but a WebSocket client) and supply
 * Origin via `headers` so the test doesn't need a real browser.
 */

let server: Server
let port: number

const ALLOWED_ORIGIN = 'http://localhost:8080'

beforeAll(async () => {
  server = createServer()
  // Wire WebSocketServer with origin verification — same shape as production.
  // eslint-disable-next-line no-new
  new WebSocketServer({
    server,
    verifyClient: buildVerifyClient({
      allowedOrigins: [ALLOWED_ORIGIN],
      allowNoOrigin: false,
    }),
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function dial(opts: { origin?: string }): Promise<{ opened: boolean; statusCode?: number }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {}
    if (opts.origin !== undefined) headers['Origin'] = opts.origin
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers })

    let settled = false
    const settle = (v: { opened: boolean; statusCode?: number }) => {
      if (settled) return
      settled = true
      resolve(v)
    }

    ws.on('open', () => {
      settle({ opened: true })
      ws.close()
    })
    ws.on('unexpected-response', (_req, res) => {
      settle({ opened: false, statusCode: res.statusCode })
    })
    ws.on('error', () => {
      // Rejected handshakes surface here too (ECONNRESET, etc.). If we
      // haven't already resolved via unexpected-response, mark it rejected.
      settle({ opened: false })
    })
  })
}

describe('WebSocketServer + verifyClient (integration)', () => {
  it('accepts a handshake with an allowed Origin', async () => {
    const result = await dial({ origin: ALLOWED_ORIGIN })
    expect(result.opened).toBe(true)
  })

  it('rejects a handshake with a disallowed Origin (no WS connection established)', async () => {
    const result = await dial({ origin: 'http://evil.example' })
    expect(result.opened).toBe(false)
    // ws responds 401 for verifyClient → false
    expect(result.statusCode).toBe(401)
  })

  it('rejects a handshake with no Origin header by default', async () => {
    const result = await dial({ origin: undefined })
    expect(result.opened).toBe(false)
    expect(result.statusCode).toBe(401)
  })
})
