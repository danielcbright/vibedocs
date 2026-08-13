/**
 * Agent-run storage: two files per run under a configurable root.
 *
 *   <runsDir>/<runId>/meta.json      identity, status, links, counters
 *   <runsDir>/<runId>/events.ndjson  append-only EventRecord log, one per line
 *
 * Files on disk, no database — consistent with the rest of VibeDocs.
 *
 * The store owns every identity decision: seq assignment, record numbering,
 * callId -> seq correlation for tool patches, and batch idempotency.
 */

import { mkdir, readFile, writeFile, rename, appendFile, readdir, stat, rm } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  applyRecords,
  ADAPTER_VERSION,
  type AgentEvent,
  type EventRecord,
  type RunLink,
  type RunMeta,
  type RunStatus,
} from '../shared/agent-run-types.js'
import type { PendingRecord } from './formats/types.js'
import { VibedocsError } from '../errors.js'

const META_FILE = 'meta.json'
const EVENTS_FILE = 'events.ndjson'
const MAX_RUN_ID_LENGTH = 128

/**
 * Validate a run id before it becomes a directory name.
 *
 * This is a security boundary, not a formatting preference: the id is joined
 * onto runsDir, so anything containing a separator or a dot-segment could
 * escape the sandbox. The allowlist is deliberately narrow.
 */
export function assertValidRunId(id: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_RUN_ID_LENGTH) {
    throw new VibedocsError('invalid', 'Run id must be 1-128 characters')
  }
  if (id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new VibedocsError('traversal', 'Run id may not contain path separators')
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new VibedocsError('invalid', 'Run id may only contain letters, digits, dot, underscore and hyphen')
  }
  return id
}

export interface CreateRunInput {
  id?: string
  title: string
  description?: string
  status?: RunStatus
  links?: RunLink[]
  format: string
  agent?: string
  project?: string
  workdir?: string
}

export interface PatchRunInput {
  title?: string
  description?: string
  status?: RunStatus
  links?: RunLink[]
  stopRequested?: boolean
}

export interface AppendResult {
  recCount: number
  eventCount: number
  /** Number of records actually written this call. */
  appended: number
  /** True when the batch was recognised as a replay and skipped entirely. */
  deduped: boolean
}

export interface RunStore {
  createRun(input: CreateRunInput): Promise<RunMeta>
  getRun(id: string): Promise<RunMeta | null>
  listRuns(): Promise<RunMeta[]>
  patchRun(id: string, patch: PatchRunInput): Promise<RunMeta>
  appendRecords(id: string, pending: PendingRecord[], clientSeq?: number): Promise<AppendResult>
  readRecords(id: string, fromRec: number): Promise<{ records: EventRecord[]; recCount: number }>
  readEvents(id: string): Promise<AgentEvent[]>
  /**
   * Remove a run and everything under it. Resolves `false` when there was
   * nothing there — deleting twice is an ordinary race (a retry, two operators),
   * so the caller decides whether absence is an error.
   */
  deleteRun(id: string): Promise<boolean>
}

export function createRunStore(opts: { runsDir: string }): RunStore {
  const { runsDir } = opts

  /** callId -> seq, per run. Rebuilt from disk on first use after a restart. */
  const callIndexes = new Map<string, Map<string, number>>()

  /**
   * Serialize writes per run. Two batches arriving concurrently would otherwise
   * interleave seq assignment against a stale meta read.
   */
  const writeChains = new Map<string, Promise<unknown>>()

  function runDir(id: string): string {
    return path.join(runsDir, assertValidRunId(id))
  }

  async function readMeta(id: string): Promise<RunMeta | null> {
    try {
      return JSON.parse(await readFile(path.join(runDir(id), META_FILE), 'utf8')) as RunMeta
    } catch {
      return null
    }
  }

  async function requireMeta(id: string): Promise<RunMeta> {
    const meta = await readMeta(id)
    if (!meta) throw new VibedocsError('not-found', `Run not found: ${id}`)
    return meta
  }

  /** Atomic: temp file then rename, so a reader never sees a half-written file. */
  async function writeMeta(meta: RunMeta): Promise<void> {
    const dir = runDir(meta.id)
    const tmp = path.join(dir, `.${META_FILE}.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8')
    await rename(tmp, path.join(dir, META_FILE))
  }

  function parseRecordLine(line: string): EventRecord | null {
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object') return null
      if (parsed.op === 'append' && parsed.event && typeof parsed.event.seq === 'number') return parsed
      if (parsed.op === 'patch' && typeof parsed.seq === 'number') return parsed
      return null
    } catch {
      return null
    }
  }

  async function readAllRecords(id: string): Promise<EventRecord[]> {
    let raw: string
    try {
      raw = await readFile(path.join(runDir(id), EVENTS_FILE), 'utf8')
    } catch {
      return []
    }
    const out: EventRecord[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      const rec = parseRecordLine(line)
      if (rec) out.push(rec)
    }
    return out
  }

  /** Rebuild callId -> seq from the log. Called once per run per process. */
  async function getCallIndex(id: string): Promise<Map<string, number>> {
    const cached = callIndexes.get(id)
    if (cached) return cached
    const index = new Map<string, number>()
    for (const rec of await readAllRecords(id)) {
      if (rec.op === 'append' && rec.event.kind === 'tool' && rec.event.tool?.callId) {
        index.set(rec.event.tool.callId, rec.event.seq)
      }
    }
    callIndexes.set(id, index)
    return index
  }

  /** Run `fn` after any in-flight write for this run has settled. */
  function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prior = writeChains.get(id) ?? Promise.resolve()
    const next = prior.then(fn, fn)
    writeChains.set(id, next.catch(() => undefined))
    return next
  }

  return {
    async createRun(input) {
      const id = input.id !== undefined ? assertValidRunId(input.id) : randomUUID()
      await mkdir(path.join(runsDir, id), { recursive: true })

      const now = Date.now()
      const existing = await readMeta(id)

      // Re-registering an existing id updates its metadata but never its
      // identity or its events — a client restarting a lane must not lose them.
      const meta: RunMeta = {
        id,
        title: input.title,
        description: input.description ?? existing?.description,
        status: input.status ?? existing?.status ?? 'running',
        links: input.links ?? existing?.links ?? [],
        format: input.format,
        agent: input.agent ?? existing?.agent,
        project: input.project ?? existing?.project,
        workdir: input.workdir ?? existing?.workdir,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        eventCount: existing?.eventCount ?? 0,
        recCount: existing?.recCount ?? 0,
        adapterVersion: ADAPTER_VERSION,
        lastClientSeq: existing?.lastClientSeq,
        stopRequested: existing?.stopRequested,
      }
      await writeMeta(meta)
      return meta
    },

    getRun(id) {
      return readMeta(id)
    },

    async listRuns() {
      let entries: string[]
      try {
        entries = await readdir(runsDir)
      } catch {
        return []
      }
      const metas: RunMeta[] = []
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        try {
          if (!(await stat(path.join(runsDir, entry))).isDirectory()) continue
        } catch {
          continue
        }
        const meta = await readMeta(entry).catch(() => null)
        if (meta) metas.push(meta)
      }
      return metas.sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async patchRun(id, patch) {
      return serialize(id, async () => {
        const meta = await requireMeta(id)
        const next: RunMeta = {
          ...meta,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.links !== undefined ? { links: patch.links } : {}),
          ...(patch.stopRequested !== undefined ? { stopRequested: patch.stopRequested } : {}),
          updatedAt: Date.now(),
        }
        await writeMeta(next)
        return next
      })
    },

    async appendRecords(id, pending, clientSeq) {
      return serialize(id, async () => {
        const meta = await requireMeta(id)

        // Batch idempotency: a client retrying the same batch must not double-write.
        if (clientSeq !== undefined && meta.lastClientSeq !== undefined && clientSeq <= meta.lastClientSeq) {
          return { recCount: meta.recCount, eventCount: meta.eventCount, appended: 0, deduped: true }
        }

        const index = await getCallIndex(id)
        const lines: string[] = []
        let seq = meta.eventCount
        let recCount = meta.recCount

        for (const rec of pending) {
          if (rec.op === 'patch') {
            const target = index.get(rec.callId)
            // A patch we cannot correlate is dropped: without a seq it has no
            // meaning, and inventing one would corrupt an unrelated event.
            if (target === undefined) continue
            lines.push(JSON.stringify({ op: 'patch', seq: target, patch: rec.patch }))
            recCount += 1
            continue
          }

          const callId = rec.event.kind === 'tool' ? rec.event.tool?.callId : undefined
          const known = callId ? index.get(callId) : undefined
          if (known !== undefined) {
            // The adapter lost its state and re-sent a completed tool call as a
            // fresh append. We already have that node — patch it instead, or the
            // original stays 'running' forever beside a duplicate.
            const { name: _n, callId: _c, label: _l, args: _a, ...changed } = rec.event.tool!
            lines.push(JSON.stringify({ op: 'patch', seq: known, patch: { tool: changed } }))
            recCount += 1
            continue
          }

          seq += 1
          const event: AgentEvent = { ...rec.event, seq }
          lines.push(JSON.stringify({ op: 'append', event }))
          recCount += 1
          if (callId) index.set(callId, seq)
        }

        if (lines.length > 0) {
          await appendFile(path.join(runDir(id), EVENTS_FILE), lines.join('\n') + '\n', 'utf8')
        }

        const next: RunMeta = {
          ...meta,
          eventCount: seq,
          recCount,
          updatedAt: Date.now(),
          ...(clientSeq !== undefined ? { lastClientSeq: clientSeq } : {}),
        }
        await writeMeta(next)

        return { recCount, eventCount: seq, appended: lines.length, deduped: false }
      })
    },

    async readRecords(id, fromRec) {
      const all = await readAllRecords(id)
      const from = Number.isFinite(fromRec) && fromRec > 0 ? Math.floor(fromRec) : 0
      return { records: all.slice(from), recCount: all.length }
    },

    async readEvents(id) {
      return applyRecords([], await readAllRecords(id))
    },

    async deleteRun(id) {
      // Validate before touching the filesystem: this method deletes, so an
      // unchecked id is destructive rather than merely leaky.
      const safeId = assertValidRunId(id)
      const dir = runDir(safeId)

      try {
        await stat(dir)
      } catch {
        return false
      }

      await rm(dir, { recursive: true, force: true })

      // Drop the in-memory state keyed by this id. Without this, a run
      // re-registered under the same id would inherit the old callId index, and
      // its first tool patch would target an event that no longer exists.
      callIndexes.delete(safeId)
      writeChains.delete(safeId)

      return true
    },
  }
}
