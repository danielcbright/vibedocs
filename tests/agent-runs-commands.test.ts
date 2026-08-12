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
    clientConfig: { linkify: [], editorScheme: 'editor://file' },
    store, ingest, renderer: createTextRenderer(), allowedOrigins: [ORIGIN],
  })
  return a
}
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const ctrl = { Origin: ORIGIN, 'Content-Type': 'application/json' }
const createRun = (id = 'r') => app.request('/api/runs', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ id, title: 'Run', format: 'cursor-stream-json' }),
})

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-cmds-')); app = build() })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('command queue', () => {
  beforeEach(async () => { await createRun() })

  it('queue → poll → ack → stopRequested clears', async () => {
    const enq = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'stop' }),
    })
    expect(enq.status).toBe(200)
    const { data: cmd } = await enq.json()
    expect(cmd.kind).toBe('stop')
    expect(cmd.id).toBeTruthy()

    const meta1 = await (await app.request('/api/runs/r')).json()
    expect(meta1.data.stopRequested).toBe(true)

    const poll = await app.request('/api/runs/r/commands?waitMs=0', { headers: auth })
    expect(poll.status).toBe(200)
    const { data: pending } = await poll.json()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(cmd.id)

    const ack = await app.request(`/api/runs/r/commands/${cmd.id}/ack`, {
      method: 'POST', headers: auth, body: JSON.stringify({ note: 'stopped' }),
    })
    expect(ack.status).toBe(200)

    const meta2 = await (await app.request('/api/runs/r')).json()
    expect(meta2.data.stopRequested).toBeFalsy()
  })

  it('long-polls with nothing queued return empty after the timeout', async () => {
    const start = Date.now()
    const res = await app.request('/api/runs/r/commands?waitMs=50', { headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  it('keeps an unacked command pending across repeated polls', async () => {
    await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'stop' }),
    })
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/runs/r/commands?waitMs=0', { headers: auth })
      const { data } = await res.json()
      expect(data).toHaveLength(1)
      expect(data[0].kind).toBe('stop')
    }
  })

  it('404s when acking an unknown command id', async () => {
    const res = await app.request('/api/runs/r/commands/00000000-0000-0000-0000-000000000000/ack', {
      method: 'POST', headers: auth, body: '{}',
    })
    expect(res.status).toBe(404)
  })

  it('400s an unknown command kind', async () => {
    const res = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'rm -rf /' }),
    })
    expect(res.status).toBe(400)
  })

  it('requires same-origin to enqueue and bearer token to poll', async () => {
    const noOrigin = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'stop' }),
    })
    expect(noOrigin.status).toBe(403)

    const badToken = await app.request('/api/runs/r/commands?waitMs=0', {
      headers: { Authorization: 'Bearer nope' },
    })
    expect(badToken.status).toBe(401)
  })

  it('does not queue a second stop while one is already outstanding', async () => {
    const first = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'stop' }),
    })
    const second = await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'stop' }),
    })
    const id1 = (await first.json()).data.id
    const id2 = (await second.json()).data.id
    expect(id1).toBe(id2)

    const { data } = await (await app.request('/api/runs/r/commands?waitMs=0', { headers: auth })).json()
    expect(data).toHaveLength(1)
  })
})

describe('feature disabled', () => {
  beforeEach(() => { app = build({ enabled: false }) })

  it('404s all three command routes when the feature is disabled', async () => {
    expect((await app.request('/api/runs/r/commands', {
      method: 'POST', headers: ctrl, body: JSON.stringify({ kind: 'stop' }),
    })).status).toBe(404)
    expect((await app.request('/api/runs/r/commands?waitMs=0', { headers: auth })).status).toBe(404)
    expect((await app.request('/api/runs/r/commands/x/ack', {
      method: 'POST', headers: auth, body: '{}',
    })).status).toBe(404)
  })
})
