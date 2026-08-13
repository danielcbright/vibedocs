import chokidar from 'chokidar'
import path from 'path'
import { readdirSync, realpathSync, statSync } from 'fs'
import { EXCLUDED_DIRS } from '../excluded-paths.js'
import type { FsEvent, FsEventListener, FsEventSource } from '../ports/fs-event-source.js'

/** Only reached when chokidar hands us no stats — see the `ignored` callback. */
function isDirectorySync(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Production adapter — wraps chokidar.
 *
 * The five chokidar event names map 1:1 to our FsEventKind so the AppState
 * subscriber doesn't have to know about chokidar at all.
 *
 * Scope is aligned with `EXCLUDED_DIRS`, the same set discovery, search and the
 * path resolver use. It previously ignored only `node_modules` and `.git`, which
 * left it watching 99,327 paths under a real set of roots — `dist/`,
 * `coverage/`, `.claude/worktrees/` and similar, none of which can ever be
 * indexed, served, or shown in a tree. Every one of those paths is a source of
 * events that can only be discarded downstream.
 */

/**
 * Absolute path prefixes whose own segments must NOT be examined by the
 * dot-directory rule — the watched roots themselves, in every spelling chokidar
 * might report.
 *
 * This exists because of two constraints that pull in opposite directions, and
 * getting either wrong fails silently:
 *
 * 1. **The root path itself contains a dot-directory.** The default root is
 *    `~/.vibedocs/roots`, so a rule that ignores any dot-segment anywhere in an
 *    absolute path matches `.vibedocs` in the prefix and ignores literally
 *    everything — live reload dies while the watcher reports itself healthy.
 * 2. **Roots are symlinks, and chokidar reports symlink-RESOLVED paths** —
 *    `/Users/x/Development/…`, not `…/roots/Development/…`. So a predicate that
 *    simply strips `rootDir` sees most real paths as "outside the root". Taking
 *    that to mean "nothing to ignore" made the watcher GROW: 866,194 entries
 *    against the real roots versus 99,333 before, because not one `node_modules`
 *    was pruned.
 *
 * Resolving each root's realpath up front satisfies both, and also means a
 * folder that legitimately lives under a dot-directory (`~/.local/share/docs`)
 * still works — its own prefix is stripped rather than matched.
 */
export function resolveIgnorePrefixes(rootDir: string, children: readonly string[]): string[] {
  const prefixes = new Set<string>([rootDir])
  const add = (p: string) => {
    try {
      prefixes.add(realpathSync(p))
    } catch {
      // Broken symlink or vanished entry — nothing to strip.
    }
  }
  add(rootDir)
  for (const child of children) add(path.join(rootDir, child))
  return [...prefixes]
}

/**
 * Segments of `absPath` below the longest matching prefix, or null when it sits
 * under none of them (in which case we decline to apply the dot rule rather than
 * risk over-ignoring).
 */
function segmentsBelowRoot(absPath: string, prefixes: readonly string[]): string[] | null {
  let best: string | null = null
  for (const prefix of prefixes) {
    if (absPath === prefix || absPath.startsWith(prefix + path.sep)) {
      if (best === null || prefix.length > best.length) best = prefix
    }
  }
  if (best === null) return null
  return absPath
    .slice(best.length)
    .split(path.sep)
    .filter((s) => s.length > 0)
}

/**
 * Should the watcher ignore this path?
 *
 * `EXCLUDED_DIRS` is matched against every segment — those names are unambiguous
 * wherever they appear, so this needs no root context and works on
 * symlink-resolved paths.
 *
 * The dot-directory rule needs root context (see `resolveIgnorePrefixes`) and
 * must consider ANCESTOR segments, not just the last one. On macOS chokidar is
 * backed by fsevents, which notifies recursively at the OS level; incoming
 * events are therefore filtered by full path rather than pruned during descent,
 * so `…/.claude/worktrees/w.md` arrives as its own event and has to be rejected
 * on `.claude` sitting in the middle of it.
 *
 * A final dot-segment is only ignored when it is known to be a directory, so
 * dot-FILES still reach AppState — `.vibedocs.config.ts` drives site-config
 * cache invalidation and must not be swallowed.
 */
export function isIgnoredWatchPath(
  absPath: string,
  isDirectory: boolean | undefined,
  prefixes: readonly string[],
): boolean {
  const below = segmentsBelowRoot(absPath, prefixes)

  // Both rules apply only to segments BELOW a watched root. Testing the whole
  // absolute path looks more defensive and is actively wrong: `EXCLUDED_DIRS`
  // contains ordinary words like `tmp`, `build` and `out`, so a root that merely
  // LIVES at such a path — `/tmp/scratch`, `/home/me/build/docs` — would have
  // every file under it ignored, and the watcher would sit there reporting
  // nothing while looking healthy. (Found by CI on Linux, where the test root is
  // under `/tmp`; macOS hides it because its temp dir is `/var/folders/…/T`.)
  //
  // When the path is under no known root we cannot strip a prefix, so fall back
  // to matching all segments — that path is either a symlink target we failed to
  // resolve or something unexpected, and under-watching a stray path is better
  // than watching a `node_modules` tree.
  const segments = below ?? absPath.split(path.sep).filter((s) => s.length > 0)

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (EXCLUDED_DIRS.has(segment)) return true

    const isLastSegment = i === segments.length - 1
    // A dot-segment that is not the last one is necessarily a directory.
    if (segment.startsWith('.') && (!isLastSegment || isDirectory === true)) {
      // Only when the root context is known: with no prefix stripped, a dot
      // segment may belong to the prefix itself (the default root is
      // `~/.vibedocs/roots`), and matching it would ignore everything.
      if (below !== null) return true
    }
  }

  return false
}

export interface ChokidarFsEventSourceOptions {
  /** Absolute path of the directory holding every project. Watched recursively. */
  rootDir: string
}

export function createChokidarFsEventSource(
  opts: ChokidarFsEventSourceOptions,
): FsEventSource {
  const listeners: FsEventListener[] = []
  const { rootDir } = opts

  let children: string[] = []
  try {
    children = readdirSync(rootDir)
  } catch {
    // Root missing at boot — nothing to resolve; the watcher stays quiet.
  }
  const ignorePrefixes = resolveIgnorePrefixes(rootDir, children)

  const watcher = chokidar.watch(`${rootDir}/**/*`, {
    ignoreInitial: true,
    // Chokidar supplies stats for effectively every call (measured: 176,869 of
    // 176,900 against the real roots, and never absent for a dot-path). The
    // statSync fallback covers the remainder rather than guessing a dot-path is
    // a file and watching a tree we meant to prune.
    ignored: (p: string, stats?: { isDirectory(): boolean }) =>
      isIgnoredWatchPath(
        p,
        stats ? stats.isDirectory() : isDirectorySync(p),
        ignorePrefixes,
      ),
  })

  function fanout(event: FsEvent): void {
    for (const l of listeners) l(event)
  }

  watcher
    .on('change', (p: string) => fanout({ kind: 'change', path: p }))
    .on('add', (p: string) => fanout({ kind: 'add', path: p }))
    .on('unlink', (p: string) => fanout({ kind: 'unlink', path: p }))
    .on('addDir', (p: string) => fanout({ kind: 'addDir', path: p }))
    .on('unlinkDir', (p: string) => fanout({ kind: 'unlinkDir', path: p }))

  return {
    subscribe(listener) {
      listeners.push(listener)
    },
    async close() {
      await watcher.close()
    },
  }
}
