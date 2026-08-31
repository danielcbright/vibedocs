/**
 * Which WebSocket URL the app should dial.
 *
 * In production the app and the server are one origin, so the page's own location
 * is the answer. Under `npm run dev` it is not: the page comes from Vite on :5173
 * while the server is on :8080, and dialling the page origin reaches Vite — where a
 * plain WebSocket **hangs**, neither opening nor erroring, because Vite's own socket
 * expects its HMR subprotocol. That left a permanent red "Disconnected –
 * reconnecting…" and live reload that never worked in dev at all (#195).
 *
 * So dev is told explicitly where the server is, rather than the app guessing. The
 * alternative was proxying `/` upgrades through Vite with `ws: true`, which puts the
 * app's socket and Vite's HMR socket on the same path and risks swallowing one.
 *
 * Pure, with `location` passed in, so both branches are testable without a browser.
 */

/**
 * The dev backend's origin, or null outside dev.
 *
 * Read from `import.meta.env` rather than a bare `define`d global. A global works
 * in a build but NOT here: the `typeof` guard needed to keep it safe in a test
 * environment is exactly what stops esbuild substituting it, so the identifier
 * survived verbatim in the dev bundle, `typeof` said "undefined", and the fallback
 * silently put the socket back on Vite. Verified by grepping what Vite actually
 * served. `import.meta.env` is substituted in dev and in a build, and vitest
 * provides it too.
 */
export function devWsTarget(): string | null {
  const env = import.meta.env as { DEV?: boolean; VITE_DEV_BACKEND?: string }
  if (!env?.DEV) return null
  return env.VITE_DEV_BACKEND ?? null
}

export function resolveWsUrl(
  location: { protocol: string; host: string },
  devTarget: string | null,
): string {
  const sameOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`

  // Null in any production bundle — the value is injected at build time — so a
  // deployed page cannot take this branch.
  if (!devTarget) return sameOrigin

  try {
    const url = new URL(devTarget)
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  } catch {
    // A malformed injected value must not leave the app dialling nothing.
    return sameOrigin
  }
}
