import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * Server boot orchestration seam (#108, Seam 2).
 *
 * `src/server.ts` is the composition root. It runs at module-import time —
 * there is no `boot()` function to call — so the test mocks every external
 * collaborator (runLive, serve, createWsClientChannel, registerStaticRoutes,
 * registerErrorHandler, and the API/upload route registrars) BEFORE
 * importing the module, drains the import, and then asserts ordering from
 * the shared call log.
 *
 * Invariants pinned here (ADR-0001 / issue #108 AC):
 *   1. `runLive` (which constructs AppState) is called BEFORE any route
 *      registration.
 *   2. `registerErrorHandler` runs FIRST among the route-registration calls,
 *      so it can translate VibedocsErrors thrown anywhere downstream.
 *   3. `registerStaticRoutes` runs LAST among the route-registration calls,
 *      so the catch-all `*` route doesn't shadow `/api/*` and `/assets/*`.
 *   4. `serve` is called AFTER all route registration.
 *   5. `setClientChannel(createWsClientChannel(...))` runs AFTER `serve`
 *      returns its HTTP Server handle.
 */

const callLog: string[] = []
const setClientChannelLog: unknown[] = []

// Vitest hoists vi.mock calls before all imports — these intercept the
// module graph that src/server.ts pulls in. Each mock records into the
// shared callLog so ordering is observable.
//
// Note: hoisted mock factories MUST be self-contained — they cannot
// reference variables from the test file's lexical scope. Use vi.hoisted
// for the shared state so the factory can pick it up.
const hoisted = vi.hoisted(() => {
  const callLog: string[] = []
  const setClientChannelLog: unknown[] = []
  const fakeServer = { __isFakeHttpServer: true }
  const fakeState = {
    listProjects: async () => [],
    renderPage: async () => ({ html: '', toc: [] }),
    search: () => [],
    searchVersion: 0,
    broadcast: () => {},
    uploadAuth: { token: null, readOnly: false, maxBytes: 1024 },
    start: async () => {},
    shutdown: async () => {},
    siteConfigCacheHas: () => false,
    projectsDir: '/fake/projects',
    setClientChannel: (channel: unknown) => {
      callLog.push('setClientChannel')
      setClientChannelLog.push(channel)
    },
  }
  return { callLog, setClientChannelLog, fakeServer, fakeState }
})

vi.mock('@hono/node-server', () => ({
  serve: (_opts: unknown, cb?: () => void) => {
    hoisted.callLog.push('serve')
    if (cb) cb()
    return hoisted.fakeServer
  },
}))

vi.mock('../src/app-state.js', async () => {
  return {
    runLive: async () => {
      hoisted.callLog.push('runLive')
      return hoisted.fakeState
    },
    // readRawFile is referenced by server.ts; keep the symbol so the import
    // doesn't fail. Tests don't exercise it.
    readRawFile: async () => '',
  }
})

vi.mock('../src/errors.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/errors.js')>()
  return {
    ...actual,
    registerErrorHandler: () => {
      hoisted.callLog.push('registerErrorHandler')
    },
  }
})

vi.mock('../src/server-routes.js', () => ({
  registerSearchRoute: () => { hoisted.callLog.push('registerSearchRoute') },
  registerFileRoute: () => { hoisted.callLog.push('registerFileRoute') },
}))

vi.mock('../src/upload-route.js', () => ({
  registerConfigRoute: () => { hoisted.callLog.push('registerConfigRoute') },
  registerUploadRoute: () => { hoisted.callLog.push('registerUploadRoute') },
}))

vi.mock('../src/static-files.js', () => ({
  registerStaticRoutes: () => { hoisted.callLog.push('registerStaticRoutes') },
}))

vi.mock('../src/adapters/ws-client-channel.js', () => ({
  createWsClientChannel: () => {
    hoisted.callLog.push('createWsClientChannel')
    return { broadcast: () => {}, close: async () => {} }
  },
}))

beforeAll(async () => {
  // Importing the server module is what triggers boot. We deliberately
  // import it once, then assert on the call log; subsequent describe
  // blocks share that single boot.
  callLog.length = 0
  setClientChannelLog.length = 0
  await import('../src/server.js')
  callLog.push(...hoisted.callLog)
  setClientChannelLog.push(...hoisted.setClientChannelLog)
})

describe('server boot orchestration', () => {
  it('calls runLive BEFORE registering any HTTP routes', () => {
    const runLiveIdx = callLog.indexOf('runLive')
    expect(runLiveIdx).toBeGreaterThanOrEqual(0)
    const firstRouteCall = callLog.findIndex((c) =>
      c === 'registerErrorHandler'
      || c === 'registerSearchRoute'
      || c === 'registerConfigRoute'
      || c === 'registerUploadRoute'
      || c === 'registerFileRoute'
      || c === 'registerStaticRoutes',
    )
    expect(firstRouteCall).toBeGreaterThan(runLiveIdx)
  })

  it('registers the error handler FIRST among route-registration calls', () => {
    const routeCalls = callLog.filter((c) => c.startsWith('register'))
    expect(routeCalls[0]).toBe('registerErrorHandler')
  })

  it('registers static routes LAST among route-registration calls (catch-all wins after API)', () => {
    const routeCalls = callLog.filter((c) => c.startsWith('register'))
    expect(routeCalls[routeCalls.length - 1]).toBe('registerStaticRoutes')
  })

  it('calls serve AFTER all route registration', () => {
    const serveIdx = callLog.indexOf('serve')
    const lastRouteIdx = (() => {
      let lastIdx = -1
      callLog.forEach((c, i) => {
        if (c.startsWith('register')) lastIdx = i
      })
      return lastIdx
    })()
    expect(serveIdx).toBeGreaterThan(lastRouteIdx)
  })

  it('swaps in the ws ClientChannel AFTER serve returns (setClientChannel runs after serve)', () => {
    const serveIdx = callLog.indexOf('serve')
    const createWsIdx = callLog.indexOf('createWsClientChannel')
    const setClientChannelIdx = callLog.indexOf('setClientChannel')
    expect(serveIdx).toBeGreaterThanOrEqual(0)
    expect(createWsIdx).toBeGreaterThan(serveIdx)
    expect(setClientChannelIdx).toBeGreaterThan(createWsIdx)
  })

  it('passes a real ClientChannel-shaped object to setClientChannel', () => {
    expect(setClientChannelLog).toHaveLength(1)
    const channel = setClientChannelLog[0] as { broadcast: unknown; close: unknown }
    expect(typeof channel.broadcast).toBe('function')
    expect(typeof channel.close).toBe('function')
  })
})
