import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, appendFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  createChokidarFsEventSource,
  resolveIgnorePrefixes,
  isIgnoredWatchPath,
} from '../src/adapters/chokidar-fs-event-source.js'
import type { FsEvent, FsEventSource } from '../src/ports/fs-event-source.js'

/**
 * The watcher over more than one root (#113).
 *
 * This predicate has produced a silent-success failure three times — a watcher
 * that reports itself healthy while delivering nothing, or one that watches
 * 866,194 paths. Both failure directions are asserted here for every root, not
 * just the first, because "green on the first root" is exactly what the earlier
 * bugs looked like.
 *
 * Note the ordinary-word hazard: `EXCLUDED_DIRS` contains `tmp`, `build` and
 * `out`, and these tests run under the OS temp directory — so a rule applied to
 * the whole absolute path instead of the segments below a root would ignore
 * everything here. That is how CI caught it on Linux (`/tmp/...`) while macOS
 * (`/var/folders/...`) hid it.
 */
let tmp: string
let src: FsEventSource | null

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-chokidar-multi-'))
  src = null
})
afterEach(async () => {
  if (src) await src.close().catch(() => {})
  await rm(tmp, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`)
}

/**
 * Append to a file until its change event arrives.
 *
 * Chokidar drops a change to a file it has not finished scanning yet, and there is
 * no ready signal on the FsEventSource port, so a single append after subscribing
 * is a race — worse with two roots, because the initial scan is twice the work.
 * Re-poking terminates as soon as the watcher is genuinely live instead of
 * guessing a settle delay, and re-running the stimulus is safe: extra change
 * events are exactly what the assertion is looking for.
 */
async function pokeUntilSeen(file: string, events: FsEvent[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await appendFile(file, '\nmore')
    try {
      await waitFor(() => events.some((e) => e.path === file), 400)
      return
    } catch {
      // Not watching it yet; poke again.
    }
  }
  throw new Error(`no event for ${file} within ${timeoutMs}ms`)
}

describe('resolveIgnorePrefixes with several roots', () => {
  it('includes every root, so the dot rule has context for all of them', async () => {
    // Without its own prefix, a root that legitimately lives under a
    // dot-directory has every path beneath it ignored.
    const a = path.join(tmp, '.hidden-parent', 'RootA')
    const b = path.join(tmp, 'RootB')
    await mkdir(path.join(a, 'alpha'), { recursive: true })
    await mkdir(path.join(b, 'beta'), { recursive: true })

    const prefixes = resolveIgnorePrefixes([a, b])
    expect(prefixes).toContain(a)
    expect(prefixes).toContain(b)
    expect(isIgnoredWatchPath(path.join(a, 'alpha', 'x.md'), false, prefixes)).toBe(false)
    expect(isIgnoredWatchPath(path.join(b, 'beta', 'x.md'), false, prefixes)).toBe(false)
  })

  it('resolves each root\'s children, so a symlinked project still gets pruned', async () => {
    // Chokidar reports symlink-RESOLVED paths. A prefix list built only from the
    // roots themselves sees those as outside every root, declines to apply the
    // rules, and stops pruning node_modules — which is how the watcher grew.
    const { symlink } = await import('fs/promises')
    const real = path.join(tmp, 'real-project')
    await mkdir(path.join(real, 'node_modules'), { recursive: true })
    const rootA = path.join(tmp, 'RootA')
    await mkdir(rootA, { recursive: true })
    await symlink(real, path.join(rootA, 'linked'))

    const prefixes = resolveIgnorePrefixes([rootA, path.join(tmp, 'RootB')])
    expect(isIgnoredWatchPath(path.join(real, 'node_modules', 'dep', 'x.md'), false, prefixes)).toBe(true)
    expect(isIgnoredWatchPath(path.join(real, 'notes.md'), false, prefixes)).toBe(false)
  })

  it('applies the exclusion rules under a later root, not only the first', () => {
    const prefixes = ['/roots/One', '/roots/Two']
    for (const root of prefixes) {
      expect(isIgnoredWatchPath(`${root}/p/node_modules/x.md`, false, prefixes)).toBe(true)
      expect(isIgnoredWatchPath(`${root}/p/dist/x.md`, false, prefixes)).toBe(true)
      expect(isIgnoredWatchPath(`${root}/p/.claude/worktrees/x.md`, false, prefixes)).toBe(true)
      expect(isIgnoredWatchPath(`${root}/p/notes.md`, false, prefixes)).toBe(false)
    }
  })

  it('does not ignore a root whose own path contains an excluded word', () => {
    // `tmp`, `build` and `out` are in EXCLUDED_DIRS and are also ordinary
    // directory names. Only segments BELOW a root may be matched.
    const prefixes = ['/tmp/scratch/RootOne', '/home/me/build/RootTwo']
    expect(isIgnoredWatchPath('/tmp/scratch/RootOne/p/x.md', false, prefixes)).toBe(false)
    expect(isIgnoredWatchPath('/home/me/build/RootTwo/p/x.md', false, prefixes)).toBe(false)
  })

  it('still takes a single root, spelled either way', async () => {
    const only = path.join(tmp, 'Only')
    await mkdir(path.join(only, 'alpha'), { recursive: true })
    expect(resolveIgnorePrefixes([only])).toContain(only)
    // The historical two-argument form: root plus its children.
    expect(resolveIgnorePrefixes(only, ['alpha'])).toContain(only)
  })
})

describe('createChokidarFsEventSource with several roots', () => {
  it('delivers events from every root', async () => {
    const a = path.join(tmp, 'RootA', 'alpha')
    const b = path.join(tmp, 'RootB', 'beta')
    await mkdir(a, { recursive: true })
    await mkdir(b, { recursive: true })
    await writeFile(path.join(a, 'x.md'), '# a')
    await writeFile(path.join(b, 'y.md'), '# b')

    const roots = [path.join(tmp, 'RootA'), path.join(tmp, 'RootB')]
    const events: FsEvent[] = []
    src = createChokidarFsEventSource({ roots })
    src.subscribe((e) => events.push(e))

    // Both, not just the first: a watcher wired to only one root passes any
    // assertion that stops at RootA.
    await pokeUntilSeen(path.join(a, 'x.md'), events)
    await pokeUntilSeen(path.join(b, 'y.md'), events)
  })

  it('does not deliver events from an excluded directory in a later root', async () => {
    const b = path.join(tmp, 'RootB', 'beta')
    await mkdir(path.join(b, 'node_modules'), { recursive: true })
    await writeFile(path.join(b, 'keep.md'), '# keep')

    const roots = [path.join(tmp, 'RootA'), path.join(tmp, 'RootB')]
    await mkdir(roots[0], { recursive: true })
    const events: FsEvent[] = []
    src = createChokidarFsEventSource({ roots })
    src.subscribe((e) => events.push(e))

    await writeFile(path.join(b, 'node_modules', 'noise.md'), '# noise')
    // Establish the watcher is live on this root FIRST, so the absence below is
    // evidence of the predicate rather than of a watcher that had not started.
    await pokeUntilSeen(path.join(b, 'keep.md'), events)
    await appendFile(path.join(b, 'node_modules', 'noise.md'), '\nmore')
    await new Promise((r) => setTimeout(r, 300))

    expect(events.filter((e) => e.path.includes('node_modules'))).toEqual([])
  })

  it('still accepts a single rootDir, as runLive has always passed', async () => {
    const only = path.join(tmp, 'Only', 'alpha')
    await mkdir(only, { recursive: true })
    await writeFile(path.join(only, 'x.md'), '# a')

    const root = path.join(tmp, 'Only')
    const events: FsEvent[] = []
    src = createChokidarFsEventSource({ rootDir: root })
    src.subscribe((e) => events.push(e))

    await pokeUntilSeen(path.join(only, 'x.md'), events)
  })
})
