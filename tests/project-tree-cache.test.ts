import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createProjectTreeCache, type ProjectTreeCache } from '../src/project-tree-cache.js'
import { discoverAcrossRoots } from '../src/discovery.js'
import { createProjectVisibility } from '../src/project-visibility.js'
import { NO_RULES } from '../src/shared/project-visibility.js'
import type { FsEvent } from '../src/ports/fs-event-source.js'

/**
 * The cached project tree must never drift from what a fresh walk would say.
 *
 * Each step changes the real filesystem, feeds the cache the events chokidar
 * would deliver (sometimes fewer — chokidar does not promise one per file), and
 * then compares the cache with a fresh `discoverAcrossRoots`. A patch that puts a
 * node in the wrong order, keeps a folder the walk would drop, or misses a
 * project rename shows up here as a diff.
 */
let tmp: string
let one: string
let two: string
let cache: ProjectTreeCache
let versions: number[]

const visibility = () => createProjectVisibility({ roots: [one, two], rules: NO_RULES, ttlMs: 0 })

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-tree-cache-')))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  for (const f of ['proj/README.md', 'proj/docs/guide.md', 'proj/zeta.png', 'other/notes.md']) {
    await mkdir(path.dirname(path.join(one, f)), { recursive: true })
    await writeFile(path.join(one, f), '# x')
  }
  await mkdir(path.join(two, 'shared'), { recursive: true })
  await writeFile(path.join(two, 'shared', 'README.md'), '# two')
  versions = []
  const v = visibility()
  cache = createProjectTreeCache({
    roots: [one, two],
    isHidden: v.isHidden,
    forgetVisibility: v.forget,
    onChange: (version) => versions.push(version),
    rebuildDelayMs: 5,
  })
  await cache.get()
})
afterEach(async () => {
  cache.cancel()
  await rm(tmp, { recursive: true, force: true })
})

async function step(events: FsEvent[]) {
  for (const ev of events) cache.apply(ev)
  await cache.settled()
  const fresh = await discoverAcrossRoots([one, two], visibility().isHidden)
  expect((await cache.get()).projects).toEqual(fresh)
}

const write = async (p: string, body = '# x') => {
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, body)
}
const ev = (kind: FsEvent['kind'], p: string): FsEvent => ({ kind, path: p })

describe('ProjectTreeCache — never drifts from a fresh walk', () => {
  it('patches added files into the order the walk uses, assets included', async () => {
    await write(path.join(one, 'proj', 'alpha.md'))
    await write(path.join(one, 'proj', 'Zulu.md'))
    await write(path.join(one, 'proj', 'docs', 'diagram.svg'))
    await step([
      ev('add', path.join(one, 'proj', 'alpha.md')),
      ev('add', path.join(one, 'proj', 'Zulu.md')),
      ev('add', path.join(one, 'proj', 'docs', 'diagram.svg')),
    ])
  })

  it('lists an empty file only once it has content, as the walk does', async () => {
    const f = path.join(one, 'proj', 'later.md')
    await writeFile(f, '')
    await step([ev('add', f)])
    await writeFile(f, '# now')
    await step([ev('change', f)])
    await writeFile(f, '')
    await step([ev('change', f)])
  })

  it('creates the folders a new file needs, with or without their addDir events', async () => {
    await write(path.join(one, 'proj', 'a', 'b', 'c', 'x.md'))
    await step([
      ev('addDir', path.join(one, 'proj', 'a')),
      ev('addDir', path.join(one, 'proj', 'a', 'b')),
      ev('addDir', path.join(one, 'proj', 'a', 'b', 'c')),
      ev('add', path.join(one, 'proj', 'a', 'b', 'c', 'x.md')),
    ])
    await write(path.join(one, 'proj', 'd', 'e', 'y.md'))
    await step([ev('add', path.join(one, 'proj', 'd', 'e', 'y.md'))])
  })

  it('removes a file but keeps its now-empty folder, and removes a folder wholesale', async () => {
    await rm(path.join(one, 'proj', 'docs', 'guide.md'))
    await step([ev('unlink', path.join(one, 'proj', 'docs', 'guide.md'))])
    await write(path.join(one, 'proj', 'tmp-folder', 'deep', 'z.md'))
    await step([ev('addDir', path.join(one, 'proj', 'tmp-folder'))])
    await rm(path.join(one, 'proj', 'tmp-folder'), { recursive: true })
    await step([ev('unlinkDir', path.join(one, 'proj', 'tmp-folder'))])
  })

  it('picks up a folder moved in whole, with no per-file events at all', async () => {
    await write(path.join(one, 'proj', 'moved', 'one.md'))
    await write(path.join(one, 'proj', 'moved', 'sub', 'two.md'))
    await step([ev('addDir', path.join(one, 'proj', 'moved'))])
  })

  it('adds and removes whole projects, renaming a shadowed one as the walk would', async () => {
    await write(path.join(two, 'fresh', 'README.md'))
    await step([ev('addDir', path.join(two, 'fresh')), ev('add', path.join(two, 'fresh', 'README.md'))])
    // A same-named project appearing in an EARLIER root qualifies the later one.
    await write(path.join(one, 'shared', 'README.md'))
    await step([ev('addDir', path.join(one, 'shared'))])
    expect((await cache.get()).projects.map((p) => p.name)).toContain('shared~RootTwo')
    await rm(path.join(one, 'other'), { recursive: true })
    await step([ev('unlinkDir', path.join(one, 'other'))])
  })

  it('lists a project that was empty once its first file arrives', async () => {
    await mkdir(path.join(one, 'empty'))
    await step([ev('addDir', path.join(one, 'empty'))])
    await write(path.join(one, 'empty', 'first.md'))
    await step([ev('add', path.join(one, 'empty', 'first.md'))])
  })

  it('ignores what the walk ignores: dotfiles, and excluded or dot directories', async () => {
    const before = versions.length
    await write(path.join(one, 'proj', '.env'), 'X=1')
    await write(path.join(one, 'proj', 'node_modules', 'pkg', 'README.md'))
    await write(path.join(one, 'proj', '.cache', 'x.md'))
    await step([
      ev('add', path.join(one, 'proj', '.env')),
      ev('addDir', path.join(one, 'proj', 'node_modules')),
      ev('add', path.join(one, 'proj', 'node_modules', 'pkg', 'README.md')),
      ev('add', path.join(one, 'proj', '.cache', 'x.md')),
    ])
    expect(versions.length).toBe(before)
  })

  it('hides a new worktree once its .git appears, even if its folder was seen first', async () => {
    const wt = path.join(one, 'repo-wt')
    await write(path.join(wt, 'README.md'))
    await step([ev('addDir', wt), ev('add', path.join(wt, 'README.md'))])
    expect((await cache.get()).projects.map((p) => p.name)).toContain('repo-wt')
    await writeFile(path.join(wt, '.git'), `gitdir: ${one}/proj/.git/worktrees/repo-wt\n`)
    await step([ev('add', path.join(wt, '.git'))])
    expect((await cache.get()).projects.map((p) => p.name)).not.toContain('repo-wt')
  })

  it('survives an add and an unlink of the same file delivered back to back', async () => {
    const f = path.join(one, 'proj', 'flicker.md')
    await write(f)
    cache.apply(ev('add', f))
    await rm(f)
    cache.apply(ev('unlink', f))
    await step([])
  })
})

describe('ProjectTreeCache — versions', () => {
  it('reports a new version only when the tree changed, and with every change', async () => {
    const f = path.join(one, 'proj', 'new.md')
    await write(f)
    await step([ev('add', f)])
    expect(versions).toEqual([1])
    // The same file again changes nothing.
    await step([ev('change', f)])
    expect(versions).toEqual([1])
    await rm(f)
    await step([ev('unlink', f)])
    expect(versions).toEqual([1, 2])
    expect((await cache.get()).version).toBe(2)
  })

  it('bumps for output the tree cannot see, such as a site config', () => {
    cache.bump()
    expect(versions).toEqual([1])
  })
})
