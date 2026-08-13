import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore } from '../src/agent-runs/store.js'
import { createIngest } from '../src/agent-runs/ingest.js'
import { createTextRenderer } from '../src/agent-runs/text-render.js'
import { registerAgentRunsRoutes } from '../src/agent-runs/routes.js'
import { registerErrorHandler } from '../src/errors.js'
import { applyRecords } from '../src/shared/agent-run-types.js'
import * as F from './agent-runs-fixtures.js'

const ORIGIN = 'http://localhost:8080'
const TOKEN = 's3cret'
let dir: string
let app: Hono

function build(over: { enabled?: boolean; token?: string | null } = {}) {
  const store = createRunStore({ runsDir: dir })
  const ingest = createIngest({ store, broadcast: () => {} })
  const a = new Hono()
  registerErrorHandler(a)
  registerAgentRunsRoutes(a, {
    cfg: { enabled: over.enabled ?? true, runsDir: dir, token: over.token === undefined ? TOKEN : over.token },
    clientConfig: { linkify: [{ pattern: 'X-\\d+', url: 'https://t.example.com/$1', kind: 'issue' }], editorScheme: 'editor://file' },
    store, ingest, renderer: createTextRenderer(), allowedOrigins: [ORIGIN],
  })
  return a
}
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const ctrl = { Origin: ORIGIN, 'Content-Type': 'application/json' }
const createRun = (id = 'r') => app.request('/api/runs', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ id, title: 'Run', format: 'cursor-stream-json', workdir: '/home/dev/app' }),
})

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-routes-')); app = build() })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('ingest auth', () => {
  it('404s every runs route when the feature is disabled', async () => {
    app = build({ enabled: false })
    expect((await createRun()).status).toBe(404)
    expect((await app.request('/api/runs')).status).toBe(404)
  })

  it('404s writes when no token is configured, so the feature cannot be fingerprinted', async () => {
    app = build({ token: null })
    expect((await createRun()).status).toBe(404)
  })

  it('401s a wrong bearer token', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', format: 'cursor-stream-json' }),
    })
    expect(res.status).toBe(401)
  })

  it('creates a run and returns its id and url', async () => {
    const res = await createRun()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ id: 'r', url: '/#/runs/r' })
  })

  it('400s an unknown format, a missing title, and a traversing id', async () => {
    for (const body of [
      { title: 'x', format: 'nope' },
      { format: 'cursor-stream-json' },
      { id: '../evil', title: 'x', format: 'cursor-stream-json' },
    ]) {
      const res = await app.request('/api/runs', { method: 'POST', headers: auth, body: JSON.stringify(body) })
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('POST events', () => {
  beforeEach(async () => { await createRun() })

  it('accepts a raw vendor batch and reports counts', async () => {
    const res = await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ format: 'cursor-stream-json', clientSeq: 1, events: [F.INIT_NO_TS, F.USER_NO_TS] }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ appended: 2, eventCount: 2, deduped: false })
  })

  it('is idempotent on a replayed clientSeq', async () => {
    const body = JSON.stringify({ format: 'cursor-stream-json', clientSeq: 1, events: [F.USER_NO_TS] })
    await app.request('/api/runs/r/events', { method: 'POST', headers: auth, body })
    const replay = await app.request('/api/runs/r/events', { method: 'POST', headers: auth, body })
    expect((await replay.json()).data.deduped).toBe(true)
  })

  it('404s an unknown run and 400s a non-array events field', async () => {
    expect((await app.request('/api/runs/ghost/events', {
      method: 'POST', headers: auth, body: JSON.stringify({ format: 'cursor-stream-json', events: [] }),
    })).status).toBe(404)
    expect((await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth, body: JSON.stringify({ format: 'cursor-stream-json', events: 'nope' }),
    })).status).toBe(400)
  })
})

describe('control writes', () => {
  beforeEach(async () => { await createRun() })

  it('accepts a same-origin PATCH with no token at all', async () => {
    const res = await app.request('/api/runs/r', { method: 'PATCH', headers: ctrl, body: JSON.stringify({ status: 'waiting' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('waiting')
  })

  it('accepts a token-only PATCH, so a machine client can report its own lifecycle', async () => {
    // The header must actually reach the gate — a unit test of the policy cannot
    // catch the route forgetting to read Authorization.
    const res = await app.request('/api/runs/r', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'waiting' }),
    })
    expect(res.status).toBe(200)
    // content-type, not just 2xx: the SPA fallback answers unmatched paths with
    // 200 text/html, so a status check alone can pass on a route that never ran.
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).data.status).toBe('waiting')
  })

  it('accepts a token-only POST to the command queue', async () => {
    const res = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: auth, body: JSON.stringify({ kind: 'stop' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).data.kind).toBe('stop')
  })

  it('403s a cross-origin PATCH and one with no Origin — this is the CSRF boundary', async () => {
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: { Origin: 'https://attacker.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })).status).toBe(403)
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    })).status).toBe(403)
  })

  it('403s a wrong token with no Origin — a failed token door does not become an open one', async () => {
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })).status).toBe(403)
  })

  it('403s a bearer header when NO token is configured, rather than treating absent as a match', async () => {
    // The dangerous shape: with no configured secret, an unguarded comparison
    // could let any Authorization header through. Origin remains the only door.
    app = build({ token: null })
    await app.request('/api/runs', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'r', title: 'Run', format: 'cursor-stream-json' }),
    })
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })).status).toBe(403)
  })

  it('404s a control write when the feature is disabled, even with a valid token', async () => {
    // Ordering guarantee: a switched-off server must not reveal token state.
    app = build({ enabled: false })
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'done' }),
    })).status).toBe(404)
  })

  it('400s an unknown status and an unsafe link scheme', async () => {
    expect((await app.request('/api/runs/r', { method: 'PATCH', headers: ctrl, body: JSON.stringify({ status: 'banana' }) })).status).toBe(400)
    expect((await app.request('/api/runs/r', {
      method: 'PATCH', headers: ctrl, body: JSON.stringify({ links: [{ label: 'x', url: 'javascript:alert(1)', kind: 'pr' }] }),
    })).status).toBe(400)
  })
})

describe('reads', () => {
  beforeEach(async () => {
    await createRun()
    await app.request('/api/runs/r/events', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ format: 'cursor-stream-json', events: [F.SHELL_STARTED, F.SHELL_COMPLETED_OK, F.ASSISTANT_MD] }),
    })
  })

  it('lists runs without requiring auth, as JSON not the SPA fallback', async () => {
    const res = await app.request('/api/runs')
    expect(res.status).toBe(200)
    // The SPA fallback answers unmatched paths with 200 text/html, so asserting
    // a 2xx alone would pass even if this route were never registered.
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).data.map((r: any) => r.id)).toEqual(['r'])
  })

  it('returns run meta, and 404s an unknown run', async () => {
    expect((await app.request('/api/runs/r')).status).toBe(200)
    expect((await app.request('/api/runs/ghost')).status).toBe(404)
  })

  it('pages records by fromRec and folds to one completed tool event', async () => {
    const { data } = await (await app.request('/api/runs/r/events?fromRec=0')).json()
    expect(data.recCount).toBe(3)
    const events = applyRecords([], data.records)
    expect(events.filter((e: any) => e.kind === 'tool')).toHaveLength(1)
    expect(events.find((e: any) => e.kind === 'tool').tool).toMatchObject({ status: 'success', exitCode: 0 })
  })

  it('returns only the tail past fromRec, and treats nonsense as 0', async () => {
    expect((await (await app.request('/api/runs/r/events?fromRec=2')).json()).data.records).toHaveLength(1)
    for (const q of ['', '?fromRec=', '?fromRec=abc', '?fromRec=-5']) {
      expect((await (await app.request(`/api/runs/r/events${q}`)).json()).data.records).toHaveLength(3)
    }
  })

  it('renders assistant markdown to html at read time', async () => {
    const { data } = await (await app.request('/api/runs/r/events')).json()
    const assistant = data.records.map((r: any) => r.event).find((e: any) => e?.kind === 'assistant')
    expect(assistant.textHtml).toContain('<h2')
    expect(assistant.text).toContain('## Plan')   // raw markdown still stored
  })

  it('serves the client config, and resolves it before the :id route', async () => {
    const { data } = await (await app.request('/api/runs/config')).json()
    expect(data.editorScheme).toBe('editor://file')
    expect(data.linkify).toHaveLength(1)
  })

  it('never leaks the ingest token in any read response', async () => {
    for (const p of ['/api/runs', '/api/runs/r', '/api/runs/config', '/api/runs/r/events']) {
      expect(await (await app.request(p)).text()).not.toContain(TOKEN)
    }
  })
})

describe('delete', () => {
  beforeEach(async () => { await createRun() })

  it('deletes a run on the control door and reports JSON', async () => {
    const res = await app.request('/api/runs/r', { method: 'DELETE', headers: ctrl })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).data).toMatchObject({ id: 'r', deleted: true })
    expect((await app.request('/api/runs/r')).status).toBe(404)
  })

  it('accepts the ingest token too, like the other control writes', async () => {
    expect((await app.request('/api/runs/r', { method: 'DELETE', headers: auth })).status).toBe(200)
  })

  it('403s with neither credential — deletion is not more open than a status change', async () => {
    expect((await app.request('/api/runs/r', { method: 'DELETE' })).status).toBe(403)
    expect((await app.request('/api/runs/r', {
      method: 'DELETE', headers: { Origin: 'https://attacker.example.com' },
    })).status).toBe(403)
    // ...and the run is still there.
    expect((await app.request('/api/runs/r')).status).toBe(200)
  })

  it('404s a run that is not there', async () => {
    expect((await app.request('/api/runs/nope', { method: 'DELETE', headers: ctrl })).status).toBe(404)
  })

  it('404s when the feature is disabled', async () => {
    app = build({ enabled: false })
    expect((await app.request('/api/runs/r', { method: 'DELETE', headers: ctrl })).status).toBe(404)
  })
})
