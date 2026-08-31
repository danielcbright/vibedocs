import { describe, it, expect } from 'vitest'
import { resolveWsUrl } from '../src/lib/ws-url'

/**
 * Which WebSocket the app dials (#195).
 *
 * In production the app and the server share one origin, so `window.location` is
 * the answer. Under `npm run dev` it is not: the page comes from Vite on :5173 and
 * the server is on :8080, and a plain WebSocket to a Vite dev server **hangs** —
 * it neither opens nor errors, because Vite's own socket expects its HMR
 * subprotocol. The result was a permanent red "Disconnected – reconnecting…" and
 * live reload that never worked in dev at all.
 *
 * The dev target is injected at build time and is null in a production bundle, so
 * the branch below cannot be reached by a deployed page.
 */
describe('resolveWsUrl', () => {
  it('uses the page origin when there is no dev target', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:8080' }, null)).toBe('ws://localhost:8080')
  })

  it('upgrades to wss on an https page', () => {
    // A page served over TLS cannot open an insecure socket; browsers block it.
    expect(resolveWsUrl({ protocol: 'https:', host: 'docs.example.com' }, null)).toBe('wss://docs.example.com')
  })

  it('keeps a non-default port and any host, since the server is self-hosted', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: '127.0.0.1:9000' }, null)).toBe('ws://127.0.0.1:9000')
    expect(resolveWsUrl({ protocol: 'http:', host: 'vibedocs.internal:8080' }, null)).toBe('ws://vibedocs.internal:8080')
  })

  it('dials the dev target instead of the page origin when one is injected', () => {
    // The page is Vite on 5173; the socket has to go to the server on 8080.
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:5173' }, 'http://localhost:8080')).toBe(
      'ws://localhost:8080',
    )
  })

  it('honours whatever port the dev target names, rather than assuming 8080', () => {
    // `VIBEDOCS_PORT=9000 npm run dev` has to work, so the port comes from the
    // same value the Vite proxy uses rather than being written twice.
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:5173' }, 'http://localhost:9000')).toBe(
      'ws://localhost:9000',
    )
  })

  it('maps an https dev target to wss', () => {
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:5173' }, 'https://dev.example.com')).toBe(
      'wss://dev.example.com',
    )
  })

  it('falls back to the page origin if the dev target is unusable', () => {
    // A malformed injected value must not leave the app dialling nothing at all.
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:5173' }, 'not a url')).toBe('ws://localhost:5173')
    expect(resolveWsUrl({ protocol: 'http:', host: 'localhost:5173' }, '')).toBe('ws://localhost:5173')
  })
})
