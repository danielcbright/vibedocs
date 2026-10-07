import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, stat, utimes, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createIndexStore } from '../src/search.js'

/**
 * A full rebuild re-reads only what changed.
 *
 * It used to read every file into a fresh map while the old one was still held —
 * measured at +82.5 MB and 3.2 s against 6,864 files — on every directory event.
 * Now an entry whose file has the same mtime and size is carried over as is, so a
 * rebuild costs a stat per file plus a read per changed one.
 *
 * Proved by editing a file while restoring its mtime and keeping its size: a
 * carried-over entry still answers with the old text. Single-file edits do not
 * depend on this — the watcher's `change` event re-reads unconditionally.
 */
let tmp: string
let root: string

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-search-incr-')))
  root = path.join(tmp, 'root')
  await mkdir(path.join(root, 'proj', 'docs'), { recursive: true })
  await writeFile(path.join(root, 'proj', 'a.md'), 'alpha original')
  await writeFile(path.join(root, 'proj', 'docs', 'b.md'), 'bravo original')
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// Whole seconds: restoring a Date would drop the sub-millisecond part of mtimeMs.
const PINNED = 1_700_000_000

async function pin(file: string) {
  await utimes(file, PINNED, PINNED)
}

async function rewriteKeepingStat(file: string, text: string) {
  const before = await stat(file)
  expect(Buffer.byteLength(text)).toBe(before.size)
  await writeFile(file, text)
  await pin(file)
}

describe('IndexStore.rebuild — incremental', () => {
  it('carries over an entry whose file kept its mtime and size, without reading it', async () => {
    await pin(path.join(root, 'proj', 'a.md'))
    const store = createIndexStore({ roots: [root] })
    await store.rebuild()
    await rewriteKeepingStat(path.join(root, 'proj', 'a.md'), 'alpha REPLACED')
    await store.rebuild()
    expect(store.search('alpha original').map((r) => r.path)).toEqual(['a.md'])
    expect(store.search('replaced')).toEqual([])
  })

  it('re-reads a file whose mtime or size changed', async () => {
    const store = createIndexStore({ roots: [root] })
    await store.rebuild()
    await writeFile(path.join(root, 'proj', 'docs', 'b.md'), 'bravo edited and longer')
    await store.rebuild()
    expect(store.search('edited and longer').map((r) => r.path)).toEqual(['docs/b.md'])
    expect(store.search('bravo original')).toEqual([])
  })

  it('picks up new files and drops vanished ones', async () => {
    const store = createIndexStore({ roots: [root] })
    await store.rebuild()
    await writeFile(path.join(root, 'proj', 'docs', 'c.md'), 'charlie new')
    await rm(path.join(root, 'proj', 'a.md'))
    await store.rebuild()
    expect(store.search('charlie').map((r) => r.path)).toEqual(['docs/c.md'])
    expect(store.search('alpha')).toEqual([])
  })

  it('still lets a single-file update re-read even when the stat is unchanged', async () => {
    await pin(path.join(root, 'proj', 'a.md'))
    const store = createIndexStore({ roots: [root] })
    await store.rebuild()
    await rewriteKeepingStat(path.join(root, 'proj', 'a.md'), 'alpha REPLACED')
    await store.updateFile(path.join(root, 'proj', 'a.md'))
    expect(store.search('replaced').map((r) => r.path)).toEqual(['a.md'])
  })
})
