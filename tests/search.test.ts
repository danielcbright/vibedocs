import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createIndexStore, resolveIndexKey } from '../src/search.js'

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

/**
 * resolveIndexKey is the single source of truth for "would a full rebuild
 * include this file, and under which (project, relPath)?". Incremental updates
 * MUST agree with the full walk, or the index silently diverges from what a
 * restart would produce — e.g. an edit under node_modules/ becoming searchable
 * until the next rebuild drops it again.
 */
describe('resolveIndexKey', () => {
  const root = '/roots'

  it('maps a file inside a project to (project, relPath)', () => {
    expect(resolveIndexKey(root, '/roots/alpha/notes.md')).toEqual({
      project: 'alpha',
      relPath: 'notes.md',
    })
  })

  it('keeps nested paths, POSIX-separated', () => {
    expect(resolveIndexKey(root, '/roots/alpha/docs/deep/x.md')).toEqual({
      project: 'alpha',
      relPath: 'docs/deep/x.md',
    })
  })

  it('accepts .markdown as well as .md', () => {
    expect(resolveIndexKey(root, '/roots/alpha/x.markdown')).not.toBeNull()
  })

  it('rejects a file sitting directly in the roots dir (rebuild walks projects only)', () => {
    expect(resolveIndexKey(root, '/roots/loose.md')).toBeNull()
  })

  it('rejects paths outside the roots dir', () => {
    expect(resolveIndexKey(root, '/etc/passwd.md')).toBeNull()
    expect(resolveIndexKey(root, '/roots/../elsewhere/x.md')).toBeNull()
  })

  it('rejects non-markdown files', () => {
    expect(resolveIndexKey(root, '/roots/alpha/logo.png')).toBeNull()
    expect(resolveIndexKey(root, '/roots/alpha/notes.txt')).toBeNull()
  })

  it('rejects every EXCLUDED_DIRS segment at any depth', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'tmp', 'temp', '_archived', 'test-projects']) {
      expect(resolveIndexKey(root, `/roots/alpha/${dir}/x.md`)).toBeNull()
      expect(resolveIndexKey(root, `/roots/alpha/deep/${dir}/x.md`)).toBeNull()
      expect(resolveIndexKey(root, `/roots/${dir}/x.md`)).toBeNull()
    }
  })

  it('rejects dot-directories and dot-files, matching the walk', () => {
    expect(resolveIndexKey(root, '/roots/alpha/.claude/worktrees/x.md')).toBeNull()
    expect(resolveIndexKey(root, '/roots/.hidden/x.md')).toBeNull()
    expect(resolveIndexKey(root, '/roots/alpha/.secret.md')).toBeNull()
  })
})

describe('createIndexStore — incremental updates', () => {
  it('updateFile makes a newly added file searchable and bumps version', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    expect(store.version).toBe(1)

    const file = path.join(projectDir, 'new.md')
    await writeFile(file, '# New\nzebracorn appears')
    await store.updateFile(file)

    expect(store.version).toBe(2)
    const hits = store.search('zebracorn')
    expect(hits).toHaveLength(1)
    expect(hits[0].project).toBe('alpha')
    expect(hits[0].path).toBe('new.md')
    expect(hits[0].filename).toBe('new.md')
  })

  it('updateFile replaces content rather than duplicating the entry', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'notes.md')
    await writeFile(file, 'oldword here')

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    expect(store.search('oldword')).toHaveLength(1)

    await writeFile(file, 'newword here')
    await store.updateFile(file)

    expect(store.search('oldword')).toHaveLength(0)
    expect(store.search('newword')).toHaveLength(1)
  })

  it('removeFile drops the entry', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'doomed.md')
    await writeFile(file, 'ephemeral content')

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    expect(store.search('ephemeral')).toHaveLength(1)

    await rm(file)
    await store.removeFile(file)

    expect(store.search('ephemeral')).toHaveLength(0)
  })

  it('updateFile on a vanished file behaves as a removal, not a throw', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'racy.md')
    await writeFile(file, 'transient content')

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    expect(store.search('transient')).toHaveLength(1)

    // change event, then the file is gone before we read it
    await rm(file)
    await expect(store.updateFile(file)).resolves.toBeTypeOf('number')
    expect(store.search('transient')).toHaveLength(0)
  })

  it('ignores paths a full rebuild would never index', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(path.join(projectDir, 'node_modules'), { recursive: true })
    await mkdir(path.join(projectDir, '.claude'), { recursive: true })
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    const versionBefore = store.version

    const excluded = path.join(projectDir, 'node_modules', 'dep.md')
    const hidden = path.join(projectDir, '.claude', 'notes.md')
    const asset = path.join(projectDir, 'logo.png')
    const loose = path.join(tmpDir, 'loose.md')
    await writeFile(excluded, 'sneakyword one')
    await writeFile(hidden, 'sneakyword two')
    await writeFile(asset, 'sneakyword three')
    await writeFile(loose, 'sneakyword four')

    for (const p of [excluded, hidden, asset, loose]) await store.updateFile(p)

    expect(store.search('sneakyword')).toHaveLength(0)
    // Nothing changed, so nothing should claim a new index version.
    expect(store.version).toBe(versionBefore)
  })

  it('skips empty files, matching rebuild()', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'empty.md')
    await writeFile(file, '')

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    await store.updateFile(file)

    // A rebuild skips size-0 files; incremental must not disagree.
    expect(store.search('')).toEqual([])
    const fresh = createIndexStore({ projectsDir: tmpDir })
    await fresh.rebuild()
    expect(store.search('anything')).toEqual(fresh.search('anything'))
  })

  it('converges on the same index a full rebuild produces', async () => {
    // The property that matters: incremental state must be indistinguishable
    // from a restart's state.
    const alpha = path.join(tmpDir, 'alpha')
    const beta = path.join(tmpDir, 'beta', 'nested')
    await mkdir(alpha, { recursive: true })
    await mkdir(beta, { recursive: true })

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()

    const a = path.join(alpha, 'one.md')
    const b = path.join(beta, 'two.md')
    const c = path.join(alpha, 'three.md')

    await writeFile(a, 'apple content')
    await store.updateFile(a)
    await writeFile(b, 'banana content')
    await store.updateFile(b)
    await writeFile(c, 'cherry content')
    await store.updateFile(c)
    await writeFile(a, 'apricot content')
    await store.updateFile(a)
    await rm(c)
    await store.removeFile(c)

    const fresh = createIndexStore({ projectsDir: tmpDir })
    await fresh.rebuild()

    // Compare as sets: result ordering follows walk order, which is not part of
    // the contract. What must match is WHICH files match and with what snippet.
    const byPath = (rs: ReturnType<typeof store.search>) =>
      [...rs].sort((x, y) => `${x.project}/${x.path}`.localeCompare(`${y.project}/${y.path}`))

    for (const q of ['apple', 'apricot', 'banana', 'cherry', 'content']) {
      expect(byPath(store.search(q)), `query "${q}"`).toEqual(byPath(fresh.search(q)))
    }
  })

  it('applies interleaved updates in call order', async () => {
    const projectDir = path.join(tmpDir, 'alpha')
    await mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'flappy.md')
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()

    await writeFile(file, 'present content')
    // Fire without awaiting between them — an add immediately followed by an
    // unlink is exactly what a watcher delivers during a git operation. Last
    // call must win regardless of IO timing.
    const p1 = store.updateFile(file)
    const p2 = store.removeFile(file)
    await Promise.all([p1, p2])

    expect(store.search('present')).toHaveLength(0)
  })
})
