/**
 * Minimal HTTP client for the Agent Runs API, shared by the scripts in this
 * directory so there is one place that knows which credential each route wants
 * and one place that guards against the SPA fallback.
 */

/**
 * Build a client bound to one server and one set of credentials.
 *
 * `token` opens ingest (register, events, command polling, ack) and — since the
 * control gate accepts either credential — control too. `origin` is only needed
 * against a server predating that change; passing it costs nothing and makes the
 * client work either way.
 */
export function createRunsClient({ url, token, origin }) {
  const base = url.replace(/\/$/, '')

  async function request(method, pathname, body, signal) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (origin) headers.Origin = origin

    const res = await fetch(`${base}${pathname}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    })

    // In production every unmatched GET returns the SPA's index.html with
    // 200 text/html, so `res.ok` alone would report a missing or misordered
    // route as success. Demand JSON before believing anything.
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('application/json')) {
      const detail = (await res.text()).slice(0, 300)
      const err = new Error(`${method} ${pathname} -> ${res.status} ${contentType}\n${detail}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  return {
    base,
    registerRun: (meta) => request('POST', '/api/runs', meta),
    appendEvents: (id, body) => request('POST', `/api/runs/${encodeURIComponent(id)}/events`, body),
    patchRun: (id, patch) => request('PATCH', `/api/runs/${encodeURIComponent(id)}`, patch),
    // `signal` matters here specifically: this request parks server-side for up
    // to waitMs, and an in-flight fetch keeps Node's event loop alive. Without a
    // way to abort it, a supervisor whose child has already exited would sit
    // there for the rest of the long-poll window before it could exit.
    listCommands: (id, waitMs, signal) =>
      request('GET', `/api/runs/${encodeURIComponent(id)}/commands?waitMs=${waitMs}`, undefined, signal),
    ackCommand: (id, cmdId, note) =>
      request('POST', `/api/runs/${encodeURIComponent(id)}/commands/${encodeURIComponent(cmdId)}/ack`, { note }),
  }
}
