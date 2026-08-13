import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { createRunStore, assertValidRunId, type RunStore } from '../src/agent-runs/store.js'
import { ADAPTER_VERSION, applyRecords } from '../src/shared/agent-run-types.js'
import type { PendingRecord } from '../src/agent-runs/formats/types.js'
import { VibedocsError } from '../src/errors.js'

let dir: string
let store: RunStore
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-runs-'))
  store = createRunStore({ runsDir: dir })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const base = { title: 'Add health endpoint', format: 'cursor-stream-json' }

describe('assertValidRunId', () => {
  it('accepts ordinary slugs', () => {
    for (const id of ['abc', 'run-1', 'a_b.c', 'A1', 'x'.repeat(128)]) {
      expect(assertValidRunId(id)).toBe(id)
    }
  })

  it('rejects every traversal and separator form', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', '../x', 'a/../b', '', ' ', 'x'.repeat(129), 'a b', 'a:b']) {
      expect(() => assertValidRunId(bad), `should reject ${JSON.stringify(bad)}`).toThrow(VibedocsError)
    }
  })

  it('codes separator escapes as traversal specifically', () => {
    try {
      assertValidRunId('../escape')
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })
})

describe('run identity', () => {
  it('creates a run, generates an id, and seeds meta', async () => {
    const meta = await store.createRun(base)
    expect(meta.id).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(meta).toMatchObject({
      title: 'Add health endpoint', status: 'running', links: [],
      format: 'cursor-stream-json', eventCount: 0, recCount: 0, adapterVersion: ADAPTER_VERSION,
    })
    expect(meta.createdAt).toBeGreaterThan(0)
  })

  it('honours a caller-supplied id and rejects a traversing one', async () => {
    expect((await store.createRun({ ...base, id: 'my-run' })).id).toBe('my-run')
    await expect(store.createRun({ ...base, id: '../evil' })).rejects.toThrow(VibedocsError)
  })

  it('re-registering an id updates metadata but preserves identity', async () => {
    const first = await store.createRun({ ...base, id: 'r1' })
    const second = await store.createRun({ ...base, id: 'r1', title: 'Renamed' })
    expect(second.title).toBe('Renamed')
    expect(second.createdAt).toBe(first.createdAt)
  })

  it('returns null for an unknown run rather than throwing', async () => {
    expect(await store.getRun('nope')).toBeNull()
  })

  it('lists runs newest-updated first, ignoring stray files', async () => {
    await store.createRun({ ...base, id: 'a' })
    await store.createRun({ ...base, id: 'b' })
    await writeFile(path.join(dir, 'stray.txt'), 'junk')
    await store.patchRun('a', { status: 'done' })
    expect((await store.listRuns()).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

function appendEvent(kind: string, over: Record<string, unknown> = {}): PendingRecord {
  return { op: 'append', event: { ts: 1000, kind: kind as any, ...over } }
}
function toolStart(callId: string, label = 'npm test'): PendingRecord {
  return {
    op: 'append',
    event: { ts: 1000, kind: 'tool', tool: { name: 'shell', callId, label, args: {}, status: 'running' } },
  }
}

describe('appendRecords', () => {
  it('assigns 1-based monotonic seq and counts records', async () => {
    await store.createRun({ ...base, id: 'r' })
    const res = await store.appendRecords('r', [appendEvent('user', { text: 'a' }), appendEvent('assistant', { text: 'b' })])
    expect(res).toMatchObject({ appended: 2, eventCount: 2, recCount: 2, deduped: false })
    expect((await store.readEvents('r')).map((e) => e.seq)).toEqual([1, 2])
  })

  it('resolves a patch by callId to the right seq, preserving append-time fields', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user'), toolStart('c1')])
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success', exitCode: 0 } as any } }])
    const events = await store.readEvents('r')
    expect(events).toHaveLength(2)
    expect(events[1].tool).toMatchObject({ callId: 'c1', label: 'npm test', status: 'success', exitCode: 0 })
  })

  it('writes the patch line with a resolved numeric seq, not a callId', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } }])
    const lines = (await readFile(path.join(dir, 'r', 'events.ndjson'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[1]).toEqual({ op: 'patch', seq: 1, patch: { tool: { status: 'success' } } })
    expect(JSON.stringify(lines[1])).not.toContain('callId')
  })

  it('drops a patch whose callId was never seen', async () => {
    await store.createRun({ ...base, id: 'r' })
    const res = await store.appendRecords('r', [{ op: 'patch', callId: 'ghost', patch: { text: 'x' } }])
    expect(res).toMatchObject({ appended: 0, recCount: 0 })
  })

  it('upgrades a duplicate tool append into a patch when the callId is already known', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])
    // Simulate a restart: a brand-new store instance, no in-memory index.
    const fresh = createRunStore({ runsDir: dir })
    await fresh.appendRecords('r', [{
      op: 'append',
      event: { ts: 2000, kind: 'tool', tool: { name: 'shell', callId: 'c1', label: 'npm test', args: {}, status: 'success', exitCode: 0, endTs: 2000 } },
    }])
    const events = await fresh.readEvents('r')
    expect(events).toHaveLength(1)                                     // no duplicate node
    expect(events[0].tool).toMatchObject({ status: 'success', exitCode: 0 })
  })

  it('rebuilds the callId index from disk when the store is recreated', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [appendEvent('user'), toolStart('c1')])
    const fresh = createRunStore({ runsDir: dir })
    await fresh.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'error' } as any } }])
    expect((await fresh.readEvents('r'))[1].tool!.status).toBe('error')
  })

  it('is idempotent on a replayed clientSeq, and accepts a higher one after', async () => {
    await store.createRun({ ...base, id: 'r' })
    expect((await store.appendRecords('r', [appendEvent('user')], 7)).deduped).toBe(false)
    expect(await store.appendRecords('r', [appendEvent('user')], 7)).toMatchObject({ deduped: true, appended: 0, eventCount: 1 })
    expect((await store.appendRecords('r', [appendEvent('assistant')], 8)).deduped).toBe(false)
    expect(await store.readEvents('r')).toHaveLength(2)
  })

  it('throws not-found for an unknown run', async () => {
    await expect(store.appendRecords('ghost', [appendEvent('user')])).rejects.toThrow(VibedocsError)
  })
})

describe('readRecords paging', () => {
  it('pages by record position and folds a tail identically to a full read', async () => {
    await store.createRun({ ...base, id: 'r' })
    await store.appendRecords('r', [toolStart('c1')])
    const page1 = await store.readRecords('r', 0)
    await store.appendRecords('r', [{ op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } }])
    const page2 = await store.readRecords('r', page1.recCount)
    expect(page2.records).toHaveLength(1)
    expect(page2.recCount).toBe(2)
    expect(applyRecords(applyRecords([], page1.records), page2.records)).toEqual(await store.readEvents('r'))
  })

  it('returns an empty page for a run with no events', async () => {
    await store.createRun({ ...base, id: 'r' })
    expect(await store.readRecords('r', 0)).toEqual({ records: [], recCount: 0 })
  })

  it('skips a corrupt line rather than failing the whole read', async () => {
    await store.createRun({ ...base, id: 'r' })
    await writeFile(path.join(dir, 'r', 'events.ndjson'), '{"op":"append","event":{"seq":1,"ts":1,"kind":"user"}}\nNOT JSON\n', 'utf8')
    expect((await store.readRecords('r', 0)).records).toHaveLength(1)
  })
})

describe('patchRun', () => {
  it('applies a partial update and leaves other fields alone', async () => {
    await store.createRun({ ...base, id: 'r', description: 'keep me' })
    expect(await store.patchRun('r', { status: 'waiting' })).toMatchObject({
      status: 'waiting', description: 'keep me', title: 'Add health endpoint',
    })
  })

  it('never leaves a truncated meta.json behind under concurrent writes', async () => {
    await store.createRun({ ...base, id: 'r' })
    await Promise.all([
      store.patchRun('r', { status: 'done' }),
      store.patchRun('r', { status: 'failed' }),
      store.patchRun('r', { status: 'waiting' }),
    ])
    const onDisk = JSON.parse(await readFile(path.join(dir, 'r', 'meta.json'), 'utf8'))
    expect(['done', 'failed', 'waiting']).toContain(onDisk.status)
  })

  it('throws not-found for an unknown run', async () => {
    await expect(store.patchRun('ghost', { status: 'done' })).rejects.toThrow(VibedocsError)
  })
})

describe('deleteRun', () => {
  it('removes the run and everything under it', async () => {
    const store = createRunStore({ runsDir: dir })
    await store.createRun({ title: 'Doomed', format: 'cursor-stream-json', id: 'doomed' })
    expect(await store.getRun('doomed')).not.toBeNull()

    expect(await store.deleteRun('doomed')).toBe(true)

    expect(await store.getRun('doomed')).toBeNull()
    expect((await store.listRuns()).map((r) => r.id)).not.toContain('doomed')
  })

  it('reports false for a run that was never there, rather than throwing', async () => {
    // Deleting twice is a normal race — two operators, or a retry. The caller
    // decides whether absence is an error; the store just says what happened.
    const store = createRunStore({ runsDir: dir })
    expect(await store.deleteRun('never-existed')).toBe(false)
  })

  it('refuses an id that would escape the runs directory', async () => {
    // Same traversal defence as every other id-taking method: this one deletes,
    // so a missing check is destructive rather than merely leaky.
    const store = createRunStore({ runsDir: dir })
    await expect(store.deleteRun('../../etc')).rejects.toThrow()
    await expect(store.deleteRun('a/b')).rejects.toThrow()
  })

  it('forgets the run\'s cached callId index, so a re-registered id starts clean', async () => {
    await store.createRun({ ...base, id: 'recycled' })
    await store.appendRecords('recycled', [toolStart('c1')])
    await store.deleteRun('recycled')

    // A run reusing the id must not inherit the old in-memory index. If it did,
    // a patch naming the stale callId would resolve to seq 1 and land on an event
    // that no longer exists — corrupting a fresh run with the previous one's history.
    await store.createRun({ ...base, id: 'recycled' })
    expect((await store.readRecords('recycled', 0)).recCount).toBe(0)

    await store.appendRecords('recycled', [
      { op: 'patch', callId: 'c1', patch: { tool: { status: 'success' } as any } },
    ])
    expect(await store.readEvents('recycled')).toEqual([])
  })
})
