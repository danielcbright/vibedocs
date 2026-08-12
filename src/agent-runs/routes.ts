/**
 * Agent Runs HTTP surface.
 *
 * Auth is split by path, not by method — see src/agent-runs/auth.ts:
 *   POST /api/runs, POST /api/runs/:id/events   bearer token (dispatch client)
 *   PATCH /api/runs/:id                          same-origin (browser UI)
 *   GET  everything                              open on loopback
 *
 * Every 'disabled' outcome renders as 404 rather than 403, so a server with the
 * feature off is indistinguishable from one that never had it.
 */

import type { Context, Hono } from 'hono'
import { checkRunsControlAuth, checkRunsIngestAuth } from './auth.js'
import type { AgentRunsEnvConfig } from './config.js'
import type { Ingest } from './ingest.js'
import type { RunStore } from './store.js'
import { enrichRecords, type TextRenderer } from './text-render.js'
import { RUN_STATUSES, type RunLink, type RunStatus } from '../shared/agent-run-types.js'
import { isSafeUrlTemplate, type AgentRunsClientConfig } from '../shared/agent-runs-config-types.js'
import { VibedocsError } from '../errors.js'

export interface AgentRunsRouteDeps {
  cfg: AgentRunsEnvConfig
  clientConfig: AgentRunsClientConfig
  store: RunStore
  ingest: Ingest
  renderer: TextRenderer
  allowedOrigins: readonly string[]
}

const VALID_LINK_KINDS = new Set(['issue', 'pr', 'ci', 'other'])

function parseLinks(value: unknown): RunLink[] {
  if (!Array.isArray(value)) throw new VibedocsError('invalid', 'links must be an array')
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new VibedocsError('invalid', 'link must be an object')
    const l = raw as Record<string, unknown>
    if (typeof l.label !== 'string' || typeof l.url !== 'string') {
      throw new VibedocsError('invalid', 'link requires string label and url')
    }
    // A link goes straight into an href. Defense in depth: the frontend
    // sanitizes too, but an executable scheme must not survive storage.
    if (!isSafeUrlTemplate(l.url)) throw new VibedocsError('invalid', 'link url scheme not allowed')
    const kind = typeof l.kind === 'string' && VALID_LINK_KINDS.has(l.kind) ? (l.kind as RunLink['kind']) : 'other'
    return { label: l.label, url: l.url, kind }
  })
}

function parseStatus(value: unknown): RunStatus {
  if (typeof value !== 'string' || !RUN_STATUSES.includes(value as RunStatus)) {
    throw new VibedocsError('invalid', `status must be one of: ${RUN_STATUSES.join(', ')}`)
  }
  return value as RunStatus
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new VibedocsError('invalid', 'Body must be a JSON object')
    }
    return body as Record<string, unknown>
  } catch (err) {
    if (err instanceof VibedocsError) throw err
    throw new VibedocsError('invalid', 'Body must be valid JSON')
  }
}

export function registerAgentRunsRoutes(app: Hono, deps: AgentRunsRouteDeps): void {
  const { cfg, clientConfig, store, ingest, renderer, allowedOrigins } = deps

  /** Returns a Response to short-circuit with, or null to proceed. */
  function ingestGate(c: Context): Response | null {
    switch (checkRunsIngestAuth(cfg, c.req.header('Authorization'))) {
      case 'disabled':
      case 'no-token-configured':
        return c.json({ error: 'Not Found' }, 404)
      case 'unauthorized':
        return c.json({ error: 'Unauthorized' }, 401)
      case 'ok':
        return null
    }
  }

  function controlGate(c: Context): Response | null {
    switch (checkRunsControlAuth(cfg, c.req.header('Origin'), allowedOrigins)) {
      case 'disabled':
        return c.json({ error: 'Not Found' }, 404)
      case 'forbidden':
        return c.json({ error: 'Forbidden' }, 403)
      case 'ok':
        return null
    }
  }

  function readGate(c: Context): Response | null {
    return cfg.enabled ? null : c.json({ error: 'Not Found' }, 404)
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  app.post('/api/runs', async (c) => {
    const denied = ingestGate(c)
    if (denied) return denied

    const body = await readJson(c)
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw new VibedocsError('invalid', 'title is required')
    }
    if (typeof body.format !== 'string') throw new VibedocsError('invalid', 'format is required')

    const meta = await ingest.registerRun({
      id: typeof body.id === 'string' ? body.id : undefined,
      title: body.title,
      description: typeof body.description === 'string' ? body.description : undefined,
      status: body.status !== undefined ? parseStatus(body.status) : undefined,
      links: body.links !== undefined ? parseLinks(body.links) : undefined,
      format: body.format,
      agent: typeof body.agent === 'string' ? body.agent : undefined,
      workdir: typeof body.workdir === 'string' ? body.workdir : undefined,
    })
    return c.json({ data: { id: meta.id, url: `/#/runs/${encodeURIComponent(meta.id)}` } })
  })

  app.post('/api/runs/:id/events', async (c) => {
    const denied = ingestGate(c)
    if (denied) return denied

    const body = await readJson(c)
    if (typeof body.format !== 'string') throw new VibedocsError('invalid', 'format is required')
    if (!Array.isArray(body.events)) throw new VibedocsError('invalid', 'events must be an array')
    const clientSeq = typeof body.clientSeq === 'number' ? body.clientSeq : undefined

    return c.json({ data: await ingest.appendRaw(c.req.param('id'), body.format, body.events, clientSeq) })
  })

  // ── Control ───────────────────────────────────────────────────────────────

  app.patch('/api/runs/:id', async (c) => {
    const denied = controlGate(c)
    if (denied) return denied

    const body = await readJson(c)
    const meta = await ingest.updateRun(c.req.param('id'), {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: parseStatus(body.status) } : {}),
      ...(body.links !== undefined ? { links: parseLinks(body.links) } : {}),
    })
    return c.json({ data: meta })
  })

  // ── Reads ─────────────────────────────────────────────────────────────────
  //
  // NOTE: '/api/runs/config' MUST stay registered before '/api/runs/:id' —
  // Hono matches in registration order, so the reverse resolves 'config' as a
  // run id and 404s.

  app.get('/api/runs', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    return c.json({ data: await store.listRuns() })
  })

  app.get('/api/runs/config', (c) => {
    const denied = readGate(c)
    if (denied) return denied
    return c.json({ data: clientConfig })
  })

  app.get('/api/runs/:id', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    const meta = await store.getRun(c.req.param('id'))
    if (!meta) throw new VibedocsError('not-found', 'Run not found')
    return c.json({ data: meta })
  })

  app.get('/api/runs/:id/events', async (c) => {
    const denied = readGate(c)
    if (denied) return denied
    const id = c.req.param('id')
    if (!(await store.getRun(id))) throw new VibedocsError('not-found', 'Run not found')

    const raw = parseInt(c.req.query('fromRec') ?? '0', 10)
    const fromRec = Number.isFinite(raw) && raw > 0 ? raw : 0
    const page = await store.readRecords(id, fromRec)
    return c.json({
      data: { records: await enrichRecords(page.records, renderer), recCount: page.recCount },
    })
  })
}
