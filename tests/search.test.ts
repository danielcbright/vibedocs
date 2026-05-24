import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createIndexStore } from '../src/search.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-search-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createIndexStore', () => {
  it('returns a store with version 0 and empty search results before rebuild', () => {
    const store = createIndexStore({ projectsDir: tmpDir })
    expect(store.version).toBe(0)
    expect(store.search('anything')).toEqual([])
  })

  it('independent instances do not share index state', async () => {
    const dirA = path.join(tmpDir, 'a')
    const dirB = path.join(tmpDir, 'b')
    await mkdir(path.join(dirA, 'proj'), { recursive: true })
    await mkdir(path.join(dirB, 'proj'), { recursive: true })
    await writeFile(path.join(dirA, 'proj', 'a.md'), '# alpha unique-to-a')
    await writeFile(path.join(dirB, 'proj', 'b.md'), '# beta unique-to-b')

    const storeA = createIndexStore({ projectsDir: dirA })
    const storeB = createIndexStore({ projectsDir: dirB })
    await storeA.rebuild()
    await storeB.rebuild()

    expect(storeA.search('unique-to-a')).toHaveLength(1)
    expect(storeA.search('unique-to-b')).toHaveLength(0)
    expect(storeB.search('unique-to-b')).toHaveLength(1)
    expect(storeB.search('unique-to-a')).toHaveLength(0)
  })

  it('version increments monotonically across rebuilds', async () => {
    const store = createIndexStore({ projectsDir: tmpDir })
    expect(store.version).toBe(0)
    await store.rebuild()
    expect(store.version).toBe(1)
    await store.rebuild()
    expect(store.version).toBe(2)
    await store.rebuild()
    expect(store.version).toBe(3)
  })

  it('rebuild() indexes markdown files and finds them by query', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'notes.md'), '# Notes\n\nThe quick brown fox jumps.')

    const store = createIndexStore({ projectsDir: tmpDir })
    const v = await store.rebuild()

    expect(v).toBe(1)
    expect(store.version).toBe(1)

    const results = store.search('quick brown')
    expect(results).toHaveLength(1)
    expect(results[0].project).toBe('alpha')
    expect(results[0].filename).toBe('notes.md')
    expect(results[0].snippet).toContain('quick brown fox')
  })
})
