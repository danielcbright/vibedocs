import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createIndexStore, resolveIndexKey } from '../src/search.js'

/**
 * The search index over more than one root (#113).
 *
 * The index decides a project's identity independently of discovery — it names
 * projects while walking — so the thing worth testing is that it lands on the
 * *same* names. A result carrying a name the path resolver cannot resolve is a
 * search hit that 404s when clicked, with nothing in any log explaining it.
 */
let tmp: string
let one: string
let two: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-search-multi-'))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  await mkdir(one, { recursive: true })
  await mkdir(two, { recursive: true })
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function doc(root: string, project: string, file: string, body: string) {
  const dir = path.join(root, project)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, file), body)
  return path.join(dir, file)
}

describe('resolveIndexKey across roots', () => {
  it('names a project in the first root bare', () => {
    expect(resolveIndexKey([one, two], path.join(one, 'alpha', 'a.md'))).toEqual({
      project: 'alpha',
      relPath: 'a.md',
    })
  })

  it('qualifies a project shadowed by an earlier root', async () => {
    // Same rule as discovery, because it is the same function underneath.
    await mkdir(path.join(one, 'shared'), { recursive: true })
    expect(resolveIndexKey([one, two], path.join(two, 'shared', 'a.md'))).toEqual({
      project: 'shared~RootTwo',
      relPath: 'a.md',
    })
  })

  it('leaves a project unqualified when no earlier root has the name', () => {
    expect(resolveIndexKey([one, two], path.join(two, 'beta', 'a.md'))?.project).toBe('beta')
  })

  it('excludes a path under no root', () => {
    expect(resolveIndexKey([one, two], path.join(tmp, 'outside', 'a.md'))).toBeNull()
  })

  it('keeps every existing exclusion, in every root', () => {
    // Scope rules are the reason this function is the single source of truth;
    // multi-root must not quietly widen them for the roots after the first.
    expect(resolveIndexKey([one, two], path.join(two, 'p', 'node_modules', 'x.md'))).toBeNull()
    expect(resolveIndexKey([one, two], path.join(two, 'p', '.git', 'x.md'))).toBeNull()
    expect(resolveIndexKey([one, two], path.join(two, 'loose.md'))).toBeNull()
    expect(resolveIndexKey([one, two], path.join(two, 'p', 'notes.txt'))).toBeNull()
  })

  it('still takes a single root as a plain string, as every caller does today', () => {
    expect(resolveIndexKey(one, path.join(one, 'alpha', 'a.md'))).toEqual({
      project: 'alpha',
      relPath: 'a.md',
    })
  })
})

describe('createIndexStore across roots', () => {
  it('indexes and finds documents from every root', async () => {
    await doc(one, 'alpha', 'a.md', 'needle in root one')
    await doc(two, 'beta', 'b.md', 'needle in root two')

    const store = createIndexStore({ roots: [one, two] })
    await store.rebuild()

    expect(store.search('needle').map((r) => r.project).sort()).toEqual(['alpha', 'beta'])
  })

  it('reports the qualified name for a shadowed project, so the hit resolves', async () => {
    await doc(one, 'shared', 'a.md', 'from one')
    await doc(two, 'shared', 'b.md', 'from two')

    const store = createIndexStore({ roots: [one, two] })
    await store.rebuild()

    const hits = store.search('from')
    expect(hits.map((h) => `${h.project}/${h.path}`).sort()).toEqual([
      'shared/a.md',
      'shared~RootTwo/b.md',
    ])
  })

  it('patches a single file in a later root without a full walk', async () => {
    // The incremental path is the one that used to be able to disagree with the
    // walk about scope; it has to agree about names too.
    await doc(one, 'alpha', 'a.md', 'unrelated')
    const store = createIndexStore({ roots: [one, two] })
    await store.rebuild()

    const added = await doc(two, 'beta', 'b.md', 'freshly written needle')
    await store.updateFile(added)
    await store.settled()

    expect(store.search('freshly').map((r) => r.project)).toEqual(['beta'])
  })

  it('removes a single file in a later root', async () => {
    const target = await doc(two, 'beta', 'b.md', 'disappearing needle')
    const store = createIndexStore({ roots: [one, two] })
    await store.rebuild()
    expect(store.search('disappearing')).toHaveLength(1)

    await store.removeFile(target)
    await store.settled()
    expect(store.search('disappearing')).toEqual([])
  })

  it('still accepts projectsDir, which is what every current caller passes', async () => {
    await doc(one, 'alpha', 'a.md', 'single root needle')
    const store = createIndexStore({ projectsDir: one })
    await store.rebuild()
    expect(store.search('needle').map((r) => r.project)).toEqual(['alpha'])
  })
})
