/**
 * The project list and file trees, held in memory and kept current from watcher
 * events, so `/api/projects` no longer walks every root on every request.
 *
 * Before this, each file change pushed `refresh-tree` and every open tab
 * re-fetched a list that re-walked every root from disk: measured at 0.6 CPU-s
 * and 1–4 MB of JSON per tab per change, against ~29,000 entries.
 *
 * Two kinds of update, chosen by how reliable the event stream is for each:
 *
 * - **A file** (`add`, `change`, `unlink`) is patched in place: one stat, then a
 *   node inserted or removed in the order the walk would have put it.
 * - **A directory** (`addDir`, `unlinkDir`) rebuilds the project it is in, after
 *   the same debounce the search re-walk uses. Chokidar does not promise a
 *   per-file event for everything inside a directory that appears or disappears
 *   in one go (a checkout, a move), so walking that project is the only way to
 *   be sure — and it is also what repairs any drift. A change at project level
 *   (a project appearing or going, a `.git` that may change its visibility)
 *   rebuilds everything, since it can change names and the list itself.
 *
 * Every mutation is serialised on one chain, so a patch can never land under a
 * rebuild that started before it. `onChange` fires with the new version only
 * after the cached tree has actually changed — a client that re-fetches then is
 * guaranteed to see the change.
 */
import path from 'path'
import { stat } from 'fs/promises'
import type { Stats } from 'fs'
import { buildTreePublic, discoverProjectDirs, type FileNode, type ProjectInfo } from './discovery.js'
import { EXCLUDED_DIRS } from './excluded-paths.js'
import { isMarkdownPath } from './markdown-paths.js'
import { createCoalescingRunner } from './coalescing-runner.js'
import type { FsEvent } from './ports/fs-event-source.js'

export interface ProjectTreeSnapshot {
  /** Every listed project with its full ('all') tree, in discovery order. */
  projects: ProjectInfo[]
  version: number
}

export interface ProjectTreeCache {
  /** The current list. Builds it on first call. */
  get(): Promise<ProjectTreeSnapshot>
  readonly version: number
  /** Feed one watcher event. Returns at once; the update is queued. */
  apply(ev: FsEvent): void
  /** The output changed for a reason the tree cannot see (a site config). */
  bump(): void
  /** Resolves once every queued patch and rebuild has landed. */
  settled(): Promise<void>
  cancel(): void
}

export interface CreateProjectTreeCacheOptions {
  roots: readonly string[]
  isHidden?: (projectDir: string) => boolean
  /** Drop any cached visibility answer for a project (its `.git` just changed). */
  forgetVisibility?: (projectDir: string) => void
  /** Called with the new version after the tree changed. */
  onChange: (version: number) => void
  rebuildDelayMs?: number
  onError?: (err: unknown) => void
}

interface Entry {
  dir: string
  project: ProjectInfo
}

export function createProjectTreeCache(opts: CreateProjectTreeCacheOptions): ProjectTreeCache {
  const { roots, onChange } = opts
  const isHidden = opts.isHidden ?? (() => false)
  let entries: Entry[] | null = null
  let version = 0

  let chain: Promise<void> = Promise.resolve()
  /** Queue one mutation. The returned promise rejects with its error; the chain carries on. */
  function serial(work: () => Promise<void>): Promise<void> {
    const run = chain.then(work)
    chain = run.catch((err) => opts.onError?.(err))
    return run
  }

  function changed(): void {
    version += 1
    onChange(version)
  }

  async function buildAll(): Promise<void> {
    entries = await discoverProjectDirs(roots, isHidden)
  }

  // ── Directory events: coalesced rebuilds ──────────────────────────────────
  let rebuildEverything = false
  const dirtyProjects = new Set<string>()
  const rebuilds = createCoalescingRunner({
    delayMs: opts.rebuildDelayMs,
    onError: opts.onError,
    run: () =>
      serial(async () => {
        const everything = rebuildEverything
        const dirty = [...dirtyProjects]
        rebuildEverything = false
        dirtyProjects.clear()
        if (entries === null) return // the first get() will build it all anyway

        const before = JSON.stringify(entries)
        // A directory event in a project the list does not have — one that was
        // empty, so never listed — can only be resolved by a full walk.
        const unknown = dirty.some((dir) => !entries!.some((e) => e.dir === dir) && !isHidden(dir))
        if (everything || unknown) {
          await buildAll()
        } else {
          for (const dir of dirty) await rebuildProject(dir)
        }
        if (JSON.stringify(entries) !== before) changed()
      }),
  })

  async function rebuildProject(dir: string): Promise<void> {
    const entry = entries!.find((e) => e.dir === dir)
    if (entry === undefined) return
    let hasDocsFolder = false
    try {
      hasDocsFolder = (await stat(path.join(dir, 'docs'))).isDirectory()
    } catch {}
    entry.project = { ...entry.project, hasDocsFolder, tree: await buildTreePublic(dir, dir) }
  }

  function scheduleEverything(): void {
    rebuildEverything = true
    rebuilds.schedule()
  }

  // ── File events: in-place patches ─────────────────────────────────────────
  async function patchFile(projectDir: string, below: string[], kind: FsEvent['kind']): Promise<void> {
    if (entries === null) return
    const entry = entries.find((e) => e.dir === projectDir)
    if (entry === undefined) {
      // A project the list does not have: hidden (leave it), or one that was
      // empty and just gained its first file (it appears now).
      if (!isHidden(projectDir)) scheduleEverything()
      return
    }
    let s: Stats | null = null
    if (kind !== 'unlink') {
      try {
        s = await stat(path.join(projectDir, ...below))
      } catch {
        s = null
      }
    }
    // The walk lists regular non-empty files only; anything else is a removal.
    const listed = s !== null && s.isFile() && s.size > 0
    const tree = entry.project.tree
    const did = listed ? upsertFile(tree, below) : removeNode(tree, below)
    if (did) changed()
  }

  return {
    get version() {
      return version
    },

    async get() {
      if (entries === null) await serial(buildAll)
      return { projects: entries!.map((e) => e.project).filter((p) => p.tree.length > 0), version }
    },

    apply(ev) {
      const located = locate(roots, ev.path)
      if (located === null) return
      const { projectDir, below } = located

      if (below.length === 0) {
        // The project directory itself. A loose file directly in a root is not
        // part of any project and never listed.
        if (ev.kind === 'addDir' || ev.kind === 'unlinkDir') scheduleEverything()
        return
      }
      if (below.length === 1 && below[0] === '.git') {
        // A worktree's `.git` file lands just after its directory; visibility
        // must be asked again, not answered from a cache taken a moment before.
        opts.forgetVisibility?.(projectDir)
        scheduleEverything()
        return
      }
      if (!walkable(below, ev.kind === 'addDir' || ev.kind === 'unlinkDir')) return

      if (ev.kind === 'addDir' || ev.kind === 'unlinkDir') {
        dirtyProjects.add(projectDir)
        rebuilds.schedule()
        return
      }
      serial(() => patchFile(projectDir, below, ev.kind)).catch(() => {})
    },

    bump() {
      if (entries !== null) changed()
    },

    async settled() {
      // A queued patch can schedule a rebuild, and a rebuild queues work on the
      // chain, so wait until a pass over both finds nothing new.
      for (;;) {
        const seen = chain
        await seen
        await rebuilds.settled()
        if (seen === chain) return
      }
    },

    cancel() {
      rebuilds.cancel()
    },
  }
}

/** The project directory an absolute path falls in, and the segments below it. */
function locate(roots: readonly string[], absPath: string): { projectDir: string; below: string[] } | null {
  for (const root of roots) {
    const rel = path.relative(root, absPath)
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const segments = rel.split(path.sep)
    return { projectDir: path.join(root, segments[0]), below: segments.slice(1) }
  }
  return null
}

/**
 * Would the walk ever list this path? It skips any dot name, and directories
 * named in EXCLUDED_DIRS. A file named like an excluded directory is still listed.
 */
function walkable(below: string[], isDir: boolean): boolean {
  for (let i = 0; i < below.length; i++) {
    const seg = below[i]
    if (seg.startsWith('.')) return false
    const isDirSegment = i < below.length - 1 || isDir
    if (isDirSegment && EXCLUDED_DIRS.has(seg)) return false
  }
  return true
}

/** Same order as the walk's `entries.sort()`: UTF-16 code units. */
function byName(a: FileNode, b: FileNode): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function insertSorted(nodes: FileNode[], node: FileNode): void {
  const at = nodes.findIndex((n) => byName(node, n) < 0)
  if (at === -1) nodes.push(node)
  else nodes.splice(at, 0, node)
}

/** Insert a file (creating folders on the way, as the walk lists them). True when the tree changed. */
function upsertFile(tree: FileNode[], below: string[]): boolean {
  let nodes = tree
  let didChange = false
  for (let i = 0; i < below.length - 1; i++) {
    const name = below[i]
    let folder = nodes.find((n) => n.name === name)
    if (folder === undefined || folder.type !== 'folder') {
      if (folder !== undefined) nodes.splice(nodes.indexOf(folder), 1)
      folder = { name, path: below.slice(0, i + 1).join(path.sep), type: 'folder', children: [] }
      insertSorted(nodes, folder)
      didChange = true
    }
    folder.children ??= []
    nodes = folder.children
  }
  const name = below[below.length - 1]
  const existing = nodes.find((n) => n.name === name)
  if (existing?.type === 'file') return didChange
  if (existing !== undefined) nodes.splice(nodes.indexOf(existing), 1)
  insertSorted(nodes, {
    name,
    path: below.join(path.sep),
    type: 'file',
    ...(!isMarkdownPath(name) && { isAsset: true }),
  })
  return true
}

/** Remove the node at `below`, leaving its folder in place as the walk would. */
function removeNode(tree: FileNode[], below: string[]): boolean {
  let nodes: FileNode[] = tree
  for (let i = 0; i < below.length - 1; i++) {
    const folder = nodes.find((n) => n.name === below[i] && n.type === 'folder')
    if (folder?.children === undefined) return false
    nodes = folder.children
  }
  const at = nodes.findIndex((n) => n.name === below[below.length - 1])
  if (at === -1) return false
  nodes.splice(at, 1)
  return true
}
