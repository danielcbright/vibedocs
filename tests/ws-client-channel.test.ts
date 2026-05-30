import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server as HttpServer } from 'http'
import { AddressInfo } from 'net'
import { WebSocket } from 'ws'
import type { Server } from 'net'
import { createWsClientChannel } from '../src/adapters/ws-client-channel.js'
import { reloadMessage, refreshTreeMessage } from '../src/shared/ws-messages.js'
import type { ClientChannel } from '../src/ports/client-channel.js'

/**
 * Production adapter test: stand up a real HTTP server on an ephemeral port,
 * attach the WsClientChannel, and assert on observable behaviour from real
 * `ws` client sockets — broadcast reaches every open client, skips a client
 * that has closed, close() shuts down the underlying server, verifyClient
 * gates the upgrade.
 */

let server: HttpServer
let port: number
let channel: ClientChannel | null

beforeEach(async () => {
  server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as AddressInfo).port
  channel = null
})

afterEach(async () => {
  if (channel) {
    await channel.close().catch(() => {})
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
      headers: { Origin: 'http://localhost' },
    })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`unexpected-response status=${res.statusCode}`))
    })
  })
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2000, intervalMs = 20 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`)
}

describe('createWsClientChannel — broadcast', () => {
  it('delivers a broadcast message to every connected client', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => true,
    })

    const a = await connectClient()
    const b = await connectClient()

    const receivedA: string[] = []
    const receivedB: string[] = []
    a.on('message', (data) => receivedA.push(String(data)))
    b.on('message', (data) => receivedB.push(String(data)))

    channel.broadcast(reloadMessage('alpha/notes.md'))

    await waitFor(() => receivedA.length === 1 && receivedB.length === 1)
    expect(JSON.parse(receivedA[0]!)).toEqual({ type: 'reload', path: 'alpha/notes.md' })
    expect(JSON.parse(receivedB[0]!)).toEqual({ type: 'reload', path: 'alpha/notes.md' })

    a.close()
    b.close()
  })

  it('skips clients that have closed before the broadcast', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => true,
    })

    const stayOpen = await connectClient()
    const willClose = await connectClient()

    const receivedOpen: string[] = []
    stayOpen.on('message', (data) => receivedOpen.push(String(data)))

    // Force a close and wait for the server side to observe it (Set delete).
    await new Promise<void>((resolve) => {
      willClose.once('close', () => resolve())
      willClose.close()
    })
    // tiny settle for the server-side 'close' handler to run
    await new Promise((r) => setTimeout(r, 50))

    channel.broadcast(refreshTreeMessage())

    await waitFor(() => receivedOpen.length === 1)
    expect(JSON.parse(receivedOpen[0]!)).toEqual({ type: 'refresh-tree' })

    stayOpen.close()
  })
})

describe('createWsClientChannel — verifyClient gate', () => {
  it('rejects handshakes when verifyClient returns false', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => false,
    })

    await expect(connectClient()).rejects.toThrow(/unexpected-response status=401/)
  })

  it('accepts handshakes when verifyClient returns true', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => true,
    })

    const ws = await connectClient()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})

describe('createWsClientChannel — close', () => {
  it('shuts the underlying WebSocketServer (subsequent dials fail)', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => true,
    })
    await channel.close()
    channel = null // signal afterEach not to double-close

    // After WS server close, the HTTP server still accepts the connection,
    // but no WebSocketServer is listening for upgrades. We treat anything
    // other than a successful 'open' as "closed". Use ws.terminate() in
    // the timeout path so a hung handshake doesn't keep the HTTP server
    // socket alive into afterEach.
    let opened = false
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
        headers: { Origin: 'http://localhost' },
      })
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }
      ws.once('open', () => { opened = true; ws.close(); done() })
      ws.once('error', done)
      ws.once('unexpected-response', done)
      ws.once('close', done)
      setTimeout(() => { ws.terminate(); done() }, 500)
    })
    expect(opened).toBe(false)
  })

  it('close() is idempotent — calling twice does not throw', async () => {
    channel = createWsClientChannel({
      server: server as unknown as Server,
      verifyClient: () => true,
    })
    await channel.close()
    await expect(channel.close()).resolves.toBeUndefined()
    channel = null
  })
})
