import { readFile, readdir, stat } from 'fs/promises'
import { statSync } from 'fs'
import path from 'path'
import { PROJECTS_DIR } from './discovery.js'
import { EXCLUDED_DIRS } from './excluded-paths.js'
import { isMarkdownPath } from './markdown-paths.js'
import { projectNameFor } from './project-roots.js'

/**
 * In-memory full-text index.
 *
 * Entries are keyed by absolute path so a single file-system event can patch
 * one entry instead of re-walking every project. That matters for memory, not
 * just speed: a full walk holds a second complete copy of every indexed file's
 * contents while it builds (~86 MB against a real multi-project root, ~3.2 s),
 * so driving one walk per event is how the server used to run out of heap.
 * `rebuild()` remains for boot and for reconciling bulk directory changes, and
 * callers must funnel it through a coalescing runner — see
 * `src/coalescing-runner.ts` and `src/app-state.ts`.
 */

interface IndexEntry {
  project: string
  path: string
  filename: string
  content: string // lowercase for matching
}

export interface SearchResult {
  project: string
  path: string
  filename: string
  snippet: string
}

export interface IndexStore {
  readonly version: number
  search(query: string, maxResults?: number): SearchResult[]
  /** Re-walk every project from scratch. Expensive; must be coalesced. */
  rebuild(): Promise<number>
  /**
   * Re-read one file and patch its entry. Cheap — one stat + one read. A path
   * a full rebuild would not index is ignored; a file that has vanished is
   * treated as a removal. Returns the resulting index version.
   */
  updateFile(absPath: string): Promise<number>
  /** Drop one file's entry. Returns the resulting index version. */
  removeFile(absPath: string): Promise<number>
  /** Test/diagnostics: resolves once every queued mutation has been applied. */
  settled(): Promise<void>
}

export interface IndexStoreOptions {
  /** Single root. Historical shape; equivalent to `roots: [projectsDir]`. */
  projectsDir?: string
  /** Every configured root, in order (#113). */
  roots?: readonly string[]
}

/** Where an indexable file lives, in the terms the wire format uses. */
export interface IndexKey {
  /** Top-level project directory name. */
  project: string
  /** Path relative to the project directory, POSIX-separated. */
  relPath: string
}

/**
 * Single source of truth for "would the index include this file, and under what
 * identity?" — used by the full walk AND by incremental updates, so the two can
 * never disagree about scope. Without a shared answer, an edit under
 * `node_modules/` could become searchable and then silently vanish at the next
 * rebuild.
 *
 * Mirrors the walk's rules: only files inside a project directory (the walk
 * never indexes loose files in the roots dir), no dot-prefixed segment, no
 * `EXCLUDED_DIRS` segment, markdown only.
 */
export function resolveIndexKey(
  rootDir: string | readonly string[],
  absPath: string,
): IndexKey | null {
  const roots = typeof rootDir === 'string' ? [rootDir] : rootDir

  // First root that contains the path. Roots cannot nest (parseRoots rejects
  // that), so at most one can match and order does not change the answer.
  const root = roots.find((r) => {
    const rel = path.relative(r, absPath)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
  if (root === undefined) return null

  const segments = path.relative(root, absPath).split(path.sep)
  // A project directory plus at least a filename. `collectAll` only descends
  // into project directories, so a loose file in the roots dir is not indexed.
  if (segments.length < 2) return null

  for (const segment of segments) {
    if (segment.startsWith('.')) return null
    if (EXCLUDED_DIRS.has(segment)) return null
  }

  if (!isMarkdownPath(segments[segments.length - 1])) return null

  // Naming goes through the same function discovery uses, so a hit always carries
  // a name the path resolver can turn back into a directory.
  const project = projectNameFor(roots, path.join(root, segments[0]), existsAsDir)
  if (project === null) return null

  return { project, relPath: segments.slice(1).join('/') }
}

/** Sync existence probe for `projectNameFor`. */
function existsAsDir(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

/** Key of the in-memory map: the absolute path. Never leaves this module. */
type IndexMap = Map<string, IndexEntry>

/**
 * Read one file into an entry, or null if it should not be indexed (missing,
 * not a regular file, or empty — a rebuild skips size-0 files).
 */
async function readEntry(absPath: string, key: IndexKey): Promise<IndexEntry | null> {
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(absPath)
  } catch {
    return null
  }
  if (!s.isFile() || s.size === 0) return null

  try {
    const content = await readFile(absPath, 'utf-8')
    return {
      project: key.project,
      path: key.relPath,
      filename: path.basename(absPath),
      content: content.toLowerCase(),
    }
  } catch {
    return null // unreadable
  }
}

async function collectInto(map: IndexMap, dir: string, roots: readonly string[]): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }

  for (const name of names) {
    if (name.startsWith('.')) continue
    const fullPath = path.join(dir, name)

    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(fullPath)
    } catch {
      continue
    }

    if (s.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue
      await collectInto(map, fullPath, roots)
      continue
    }

    // Scope decision goes through resolveIndexKey so the walk and incremental
    // updates cannot drift apart.
    const key = resolveIndexKey(roots, fullPath)
    if (key === null) continue
    const entry = await readEntry(fullPath, key)
    if (entry !== null) map.set(fullPath, entry)
  }
}

async function collectAll(roots: readonly string[]): Promise<IndexMap> {
  const map: IndexMap = new Map()

  for (const rootDir of roots) {
    let projects: string[]
    try {
      projects = await readdir(rootDir)
    } catch {
      // A configured root that is not there must not stop the others.
      continue
    }

    for (const name of projects.sort()) {
      if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue
      const projectDir = path.join(rootDir, name)

      try {
        const s = await stat(projectDir)
        if (!s.isDirectory()) continue
      } catch {
        continue
      }

      await collectInto(map, projectDir, roots)
    }
  }

  return map
}

export function createIndexStore(options: IndexStoreOptions = {}): IndexStore {
  const roots = options.roots ?? [options.projectsDir ?? PROJECTS_DIR]
  let entries: IndexMap = new Map()
  let version = 0

  /**
   * Serialises every mutation. A watcher can deliver an add and an unlink for
   * the same path back to back, and the caller does not await between them —
   * without a queue the slower read could land after the removal and resurrect
   * a deleted file. Also keeps a full rebuild from clobbering an incremental
   * patch that arrived while it was walking.
   */
  let chain: Promise<void> = Promise.resolve()
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    get version() {
      return version
    },

    search(query: string, maxResults = 20): SearchResult[] {
      const q = query.toLowerCase().trim()
      if (!q) return []

      const results: SearchResult[] = []

      for (const entry of entries.values()) {
        const pos = entry.content.indexOf(q)
        if (pos === -1) continue

        const start = Math.max(0, pos - 50)
        const end = Math.min(entry.content.length, pos + q.length + 50)
        let snippet = entry.content.slice(start, end).replace(/\n/g, ' ').trim()
        if (start > 0) snippet = '...' + snippet
        if (end < entry.content.length) snippet = snippet + '...'

        results.push({
          project: entry.project,
          path: entry.path,
          filename: entry.filename,
          snippet,
        })

        if (results.length >= maxResults) break
      }

      return results
    },

    rebuild(): Promise<number> {
      return serial(async () => {
        entries = await collectAll(roots)
        version += 1
        return version
      })
    },

    updateFile(absPath: string): Promise<number> {
      return serial(async () => {
        const key = resolveIndexKey(roots, absPath)
        // Out of scope for the index — and out of scope means out of scope even
        // if we happen to hold a stale entry for it, so nothing to remove.
        if (key === null) return version

        const entry = await readEntry(absPath, key)
        if (entry === null) {
          // Gone, unreadable, or now empty — a rebuild would not list it.
          if (entries.delete(absPath)) version += 1
          return version
        }

        entries.set(absPath, entry)
        version += 1
        return version
      })
    },

    removeFile(absPath: string): Promise<number> {
      return serial(async () => {
        if (entries.delete(absPath)) version += 1
        return version
      })
    },

    settled(): Promise<void> {
      return serial(async () => undefined)
    },
  }
}
