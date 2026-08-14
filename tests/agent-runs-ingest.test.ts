import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore, type RunStore } from '../src/agent-runs/store.js'
import { createIngest, type Ingest } from '../src/agent-runs/ingest.js'
import { VibedocsError } from '../src/errors.js'
import type { WsMessage } from '../src/shared/ws-messages.js'
import * as F from './agent-runs-fixtures.js'

let dir: string, store: RunStore, ingest: Ingest, sent: WsMessage[]

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-ingest-'))
  store = createRunStore({ runsDir: dir })
  sent = []
  ingest = createIngest({ store, broadcast: (m) => sent.push(m), now: () => 1_800_000_000_000 })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const base = { title: 'Run', format: 'cursor-stream-json' }
const CURSOR = 'cursor-stream-json'

describe('registerRun', () => {
  it('creates the run and broadcasts a run-updated nudge', async () => {
    expect((await ingest.registerRun({ ...base, id: 'r' })).id).toBe('r')
    expect(sent).toEqual([{ type: 'run-updated', runId: 'r' }])
  })

  it('rejects an unknown format before touching the disk', async () => {
    await expect(ingest.registerRun({ ...base, id: 'r2', format: 'nope' })).rejects.toThrow(VibedocsError)
    expect(await store.getRun('r2')).toBeNull()
  })
})

describe('appendRaw', () => {
  beforeEach(async () => { await ingest.registerRun({ ...base, id: 'r' }); sent.length = 0 })

  it('normalizes raw vendor lines into canonical records', async () => {
    const res = await ingest.appendRaw('r', CURSOR, [F.INIT_NO_TS, F.USER_NO_TS])
    expect(res.appended).toBe(2)
    expect((await store.readEvents('r')).map((e) => e.kind)).toEqual(['init', 'user'])
  })

  it('broadcasts a nudge carrying the record count, not the payload', async () => {
    await ingest.appendRaw('r', CURSOR, [F.USER_NO_TS])
    expect(sent).toEqual([{ type: 'run-records', runId: 'r', recCount: 1 }])
  })

  it('does not broadcast when a batch produced no records', async () => {
    // A lone thinking delta buffers in adapter state and emits nothing yet.
    await ingest.appendRaw('r', CURSOR, [F.THINKING_DELTAS[0]])
    expect(sent).toEqual([])
  })

  it('carries adapter state across calls so a tool pairs and thinking coalesces', async () => {
    await ingest.appendRaw('r', CURSOR, [F.SHELL_STARTED, F.THINKING_DELTAS[0]])
    await ingest.appendRaw('r', CURSOR, [F.THINKING_DELTAS[1], F.THINKING_DELTAS[2], F.SHELL_COMPLETED_OK])
    const events = await store.readEvents('r')
    expect(events.find((e) => e.kind === 'tool')!.tool).toMatchObject({ status: 'success', exitCode: 0 })
    const thinking = events.filter((e) => e.kind === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0].text).toBe('**Reading** the router setup')
  })

  it('keeps adapter state separate per run', async () => {
    await ingest.registerRun({ ...base, id: 'b' })
    await ingest.appendRaw('r', CURSOR, [F.SHELL_STARTED])
    await ingest.appendRaw('b', CURSOR, [F.SHELL_COMPLETED_OK])
    expect((await store.readEvents('r'))[0].tool!.status).toBe('running')
    expect((await store.readEvents('b'))[0].tool!.status).toBe('success')
  })

  it('rejects an unknown format and an unknown run', async () => {
    await expect(ingest.appendRaw('r', 'nope', [F.USER_NO_TS])).rejects.toThrow(VibedocsError)
    await expect(ingest.appendRaw('ghost', CURSOR, [F.USER_NO_TS])).rejects.toThrow(VibedocsError)
  })

  it('passes clientSeq through so a replayed batch is deduped', async () => {
    await ingest.appendRaw('r', CURSOR, [F.USER_NO_TS], 1)
    expect((await ingest.appendRaw('r', CURSOR, [F.USER_NO_TS], 1)).deduped).toBe(true)
    expect(await store.readEvents('r')).toHaveLength(1)
  })

  it('server-stamps undated events using the injected clock', async () => {
    await ingest.appendRaw('r', CURSOR, [F.RESULT_NO_TS])
    expect((await store.readEvents('r'))[0].ts).toBe(1_800_000_000_000)
  })

  it('evicts least-recently-used adapter state past the bound, staying correct', async () => {
    const small = createIngest({ store, broadcast: () => {}, maxAdapterStates: 2 })
    for (const id of ['x', 'y', 'z']) await small.registerRun({ ...base, id })
    await small.appendRaw('x', CURSOR, [F.SHELL_STARTED])
    await small.appendRaw('y', CURSOR, [F.SHELL_STARTED])
    await small.appendRaw('z', CURSOR, [F.SHELL_STARTED])  // evicts x
    // x lost openCalls, so the completion arrives as a fresh append — which the
    // store then upgrades back into a patch. Net effect: still one correct node.
    await small.appendRaw('x', CURSOR, [F.SHELL_COMPLETED_OK])
    const events = await store.readEvents('x')
    expect(events).toHaveLength(1)
    expect(events[0].tool!.status).toBe('success')
  })
})

describe('updateRun', () => {
  it('patches meta and broadcasts run-updated', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    sent.length = 0
    expect((await ingest.updateRun('r', { status: 'waiting' })).status).toBe('waiting')
    expect(sent).toEqual([{ type: 'run-updated', runId: 'r' }])
  })

  it('drops adapter state when a run reaches a terminal status', async () => {
    await ingest.registerRun({ ...base, id: 'r' })
    await ingest.appendRaw('r', CURSOR, [F.SHELL_STARTED])
    await ingest.updateRun('r', { status: 'done' })
    await ingest.appendRaw('r', CURSOR, [F.SHELL_COMPLETED_OK])
    expect(await store.readEvents('r')).toHaveLength(1)
  })
})
