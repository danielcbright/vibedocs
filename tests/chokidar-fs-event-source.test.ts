import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, appendFile, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  createChokidarFsEventSource,
  isIgnoredWatchPath,
} from '../src/adapters/chokidar-fs-event-source.js'
import type { FsEvent, FsEventSource } from '../src/ports/fs-event-source.js'

/**
 * Production adapter test: wires chokidar against a real tmpdir and asserts
 * the public FsEventSource contract — subscribe-then-emit delivers, close()
 * stops delivery, close() is idempotent. Chokidar is asynchronous so we use
 * a tiny waitFor helper rather than fixed sleeps.
 */

let tmpDir: string
let src: FsEventSource | null

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-chokidar-test-'))
  src = null
})

afterEach(async () => {
  if (src) {
    await src.close().catch(() => {})
  }
  await rm(tmpDir, { recursive: true, force: true })
})

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`)
}

/**
 * The watcher used to ignore only node_modules/ and .git/, so it watched 99,327
 * paths under a real set of roots — including dist/, coverage/ and
 * .claude/worktrees/, none of which can ever be indexed or served. Narrowing it
 * to EXCLUDED_DIRS aligns the watcher with discovery, search and the path
 * resolver.
 */
describe('isIgnoredWatchPath', () => {
  // The real shape: a dot-directory root holding symlinks, so chokidar reports
  // BOTH spellings — the roots path and the symlink-resolved target.
  const root = '/Users/someone/.vibedocs/roots'
  const prefixes = [root, '/Users/someone/Development', '/Users/someone/.local/share/notes']

  it('does NOT ignore everything just because the root path contains a dot segment', () => {
    // A rule that ignored any dot-segment anywhere in an absolute path would
    // match `.vibedocs` in the prefix and silently kill live reload for every
    // file, with the watcher still reporting itself healthy.
    expect(isIgnoredWatchPath(`${root}/alpha/notes.md`, false, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha`, true, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha/docs/guide.md`, false, prefixes)).toBe(false)
  })

  it('filters symlink-RESOLVED paths that fall outside the roots dir', () => {
    // Regression: roots are symlinks, so chokidar reports the resolved path.
    // Treating those as "outside the root, nothing to ignore" made the watcher
    // GROW to 866,194 entries from 99,333 — not one node_modules was pruned.
    const dev = '/Users/someone/Development'
    expect(isIgnoredWatchPath(`${dev}/proj/node_modules`, true, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(`${dev}/proj/node_modules/dep/x.md`, false, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(`${dev}/proj/.claude`, true, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(`${dev}/proj/.claude/worktrees/w/x.md`, false, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(`${dev}/proj/notes.md`, false, prefixes)).toBe(false)
  })

  it('rejects a dot-directory ANCESTOR, not just the last segment', () => {
    // macOS chokidar is fsevents-backed: it notifies recursively at the OS level
    // and filters by full path, so a file event arrives for a path under an
    // ignored directory and must be rejected on the ancestor.
    expect(isIgnoredWatchPath(`${root}/alpha/.claude/worktrees/w.md`, false, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(`${root}/alpha/deep/.cache/blob.md`, false, prefixes)).toBe(true)
  })

  it('ignores every EXCLUDED_DIRS name at any depth, dir or file', () => {
    for (const dir of ['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', 'tmp', 'temp', '_archived', '.project-template', 'test-projects']) {
      expect(isIgnoredWatchPath(`${root}/alpha/${dir}`, true, prefixes), dir).toBe(true)
      expect(isIgnoredWatchPath(`${root}/alpha/${dir}/x.md`, false, prefixes), dir).toBe(true)
      expect(isIgnoredWatchPath(`${root}/alpha/deep/${dir}/nested/x.md`, false, prefixes), dir).toBe(true)
    }
  })

  it('supports a root that legitimately lives under a dot-directory', () => {
    // ~/.local/share/notes is a valid folder to index. Its own prefix is
    // stripped, so `.local` must not disqualify everything beneath it.
    const notes = '/Users/someone/.local/share/notes'
    expect(isIgnoredWatchPath(`${notes}/guide.md`, false, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${notes}/sub/guide.md`, false, prefixes)).toBe(false)
    // ...while dot-dirs BELOW it are still ignored.
    expect(isIgnoredWatchPath(`${notes}/.cache/guide.md`, false, prefixes)).toBe(true)
  })

  it('declines to apply the dot rule to paths under no known root', () => {
    // Better to under-ignore an unrecognised path than to ignore a whole tree.
    expect(isIgnoredWatchPath('/somewhere/.odd/x.md', false, prefixes)).toBe(false)
    // EXCLUDED_DIRS still applies — it needs no root context.
    expect(isIgnoredWatchPath('/somewhere/node_modules/x.md', false, prefixes)).toBe(true)
  })

  it('does NOT ignore a dot-FILE — .vibedocs.config.ts must still fire', () => {
    // Site-config cache invalidation depends on this event reaching AppState.
    expect(isIgnoredWatchPath(`${root}/alpha/.vibedocs.config.ts`, false, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha/.vibedocs.config.ts`, undefined, prefixes)).toBe(false)
  })

  it('does not ignore ordinary project paths', () => {
    expect(isIgnoredWatchPath(`${root}/alpha`, true, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha/docs`, true, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha/logo.png`, false, prefixes)).toBe(false)
  })

  it('does not ignore the root itself', () => {
    expect(isIgnoredWatchPath(root, true, prefixes)).toBe(false)
  })

  it('prefers the longest matching prefix', () => {
    // A nested root must strip its own prefix, not its parent's, or its
    // dot-segments would be examined as if they were project content.
    const nested = [root, `${root}/alpha/.hidden-root`]
    expect(isIgnoredWatchPath(`${root}/alpha/.hidden-root/x.md`, false, nested)).toBe(false)
    expect(isIgnoredWatchPath(`${root}/alpha/.hidden-root/x.md`, false, [root])).toBe(true)
  })
})

describe('createChokidarFsEventSource', () => {
  it('delivers `add` events when a file is created under the watched dir', async () => {
    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    // Give chokidar enough time to complete its initial scan + ready
    // handshake before mutating. Without this the first add fires before
    // the watcher is actually watching and we race the FS.
    await new Promise((r) => setTimeout(r, 300))

    const target = path.join(tmpDir, 'hello.md')
    await writeFile(target, '# hello')

    await waitFor(() =>
      received.some((ev) => ev.kind === 'add' && ev.path === target),
    )
  })

  it('delivers `change` events when an existing file is appended', async () => {
    const target = path.join(tmpDir, 'notes.md')
    await writeFile(target, '# initial')

    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    // Settle initial subscription before mutating to avoid the racy first-add
    // chokidar sometimes emits even with ignoreInitial when the file exists.
    await new Promise((r) => setTimeout(r, 200))
    await appendFile(target, '\nmore content\n')

    await waitFor(() =>
      received.some((ev) => ev.kind === 'change' && ev.path === target),
    )
  })

  it('delivers `unlink` events when a file is removed', async () => {
    const target = path.join(tmpDir, 'goodbye.md')
    await writeFile(target, 'bye')

    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 200))

    await unlink(target)

    await waitFor(() =>
      received.some((ev) => ev.kind === 'unlink' && ev.path === target),
    )
  })

  it('close() prevents further event delivery', async () => {
    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 200))

    await src.close()

    await writeFile(path.join(tmpDir, 'after-close.md'), 'late')
    // Give chokidar a generous window to mis-fire if it were going to.
    await new Promise((r) => setTimeout(r, 500))

    expect(received.some((ev) => ev.path.endsWith('after-close.md'))).toBe(false)
  })

  it('close() is idempotent — calling twice does not throw', async () => {
    src = createChokidarFsEventSource({ rootDir: tmpDir })
    await src.close()
    await expect(src.close()).resolves.toBeUndefined()
  })

  it('delivers no events for files inside EXCLUDED_DIRS or dot-directories', async () => {
    await mkdir(path.join(tmpDir, 'alpha', 'node_modules'), { recursive: true })
    await mkdir(path.join(tmpDir, 'alpha', 'dist'), { recursive: true })
    await mkdir(path.join(tmpDir, 'alpha', '.claude', 'worktrees'), { recursive: true })

    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 300))

    await writeFile(path.join(tmpDir, 'alpha', 'node_modules', 'dep.md'), 'x')
    await writeFile(path.join(tmpDir, 'alpha', 'dist', 'built.md'), 'x')
    await writeFile(path.join(tmpDir, 'alpha', '.claude', 'worktrees', 'w.md'), 'x')
    // A path that MUST arrive, used as the fence: once we have seen it, the
    // ignored writes above have had at least as long to show up.
    const sentinel = path.join(tmpDir, 'alpha', 'real.md')
    await writeFile(sentinel, 'x')

    await waitFor(() => received.some((ev) => ev.path === sentinel))
    await new Promise((r) => setTimeout(r, 300))

    expect(received.filter((ev) => ev.path.includes('node_modules'))).toEqual([])
    expect(received.filter((ev) => ev.path.includes(`${path.sep}dist${path.sep}`))).toEqual([])
    expect(received.filter((ev) => ev.path.includes('.claude'))).toEqual([])
  })

  it('still delivers .vibedocs.config.ts events', async () => {
    // Regression guard: narrowing the watcher must not swallow the dot-file the
    // site-config cache invalidates on.
    await mkdir(path.join(tmpDir, 'alpha'), { recursive: true })

    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))
    await new Promise((r) => setTimeout(r, 300))

    const config = path.join(tmpDir, 'alpha', '.vibedocs.config.ts')
    await writeFile(config, 'export default {}')

    await waitFor(() => received.some((ev) => ev.path === config))
  })

  it('fans out a single file event to multiple subscribers', async () => {
    src = createChokidarFsEventSource({ rootDir: tmpDir })
    const a: FsEvent[] = []
    const b: FsEvent[] = []
    src.subscribe((ev) => a.push(ev))
    src.subscribe((ev) => b.push(ev))
    await new Promise((r) => setTimeout(r, 300))

    const target = path.join(tmpDir, 'fanout.md')
    await writeFile(target, 'x')

    await waitFor(() =>
      a.some((ev) => ev.path === target) && b.some((ev) => ev.path === target),
    )
  })
})
