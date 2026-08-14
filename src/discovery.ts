import { readdir, stat } from 'fs/promises'
import { statSync } from 'fs'
import path from 'path'
import type { SiteConfig } from './site-config.js'
import { EXCLUDED_DIRS } from './excluded-paths.js'
import { isMarkdownPath } from './markdown-paths.js'
import { parseRoots, projectNameFor } from './project-roots.js'

/**
 * Configured roots, snapshotted from the environment at module load.
 *
 * The snapshot is load-bearing, not incidental: `src/cli/serve-live.ts` re-execs
 * the server as a child process precisely because this is read once, so setting
 * the variable after import would be ignored. See the note in that file.
 *
 * A broken configuration is not thrown here — a module-level throw during import
 * produces a stack trace instead of an explanation. `PROJECT_ROOTS_ERROR` carries
 * it to the composition root, which exits with the message.
 */
const rootsResult = parseRoots(process.env, process.cwd())
export const PROJECT_ROOTS: readonly string[] = rootsResult.ok ? rootsResult.roots : []
export const PROJECT_ROOTS_ERROR: string | null = rootsResult.ok ? null : rootsResult.error
export const PROJECT_ROOTS_NOTES: readonly string[] = rootsResult.ok ? rootsResult.notes ?? [] : []

/**
 * The first configured root. Kept because plenty of call sites are inherently
 * single-root (the build CLI resolves one project by name) and because it is the
 * default every `projectsDir` parameter falls back to.
 */
export const PROJECTS_DIR = PROJECT_ROOTS[0] ?? process.cwd()

export interface FileNode {
  name: string
  path: string  // relative to project root
  type: 'file' | 'folder'
  children?: FileNode[]
  isAsset?: boolean
}

export interface ProjectInfo {
  name: string
  hasDocsFolder: boolean
  tree: FileNode[]
  /**
   * Optional, set by the /api/projects pipeline (see src/site-config-cache.ts).
   * `discoverProjects` itself never sets this — the cache layer attaches it on
   * top of the discovered shape. Frontend consumers should treat it as
   * `SiteConfig | null | undefined`.
   */
  siteConfig?: SiteConfig | null
}

async function buildTree(dir: string, projectRoot: string): Promise<FileNode[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const nodes: FileNode[] = []

  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue

    const fullPath = path.join(dir, entry)
    const relPath = path.relative(projectRoot, fullPath)

    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(fullPath)
    } catch {
      continue
    }

    if (s.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue
      const children = await buildTree(fullPath, projectRoot)
      nodes.push({ name: entry, path: relPath, type: 'folder', children })
    } else if (s.isFile()) {
      if (s.size === 0) continue  // skip empty files
      const isMd = isMarkdownPath(entry)
      nodes.push({
        name: entry,
        path: relPath,
        type: 'file',
        ...(!isMd && { isAsset: true }),
      })
    }
  }

  return nodes
}

export async function discoverProjects(
  projectsDir: string = PROJECTS_DIR,
): Promise<ProjectInfo[]> {
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  } catch {
    return []
  }

  const projects: ProjectInfo[] = []

  for (const name of entries.sort()) {
    if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue

    const projectDir = path.join(projectsDir, name)
    try {
      const s = await stat(projectDir)
      if (!s.isDirectory()) continue
    } catch {
      continue
    }

    const docsDir = path.join(projectDir, 'docs')
    let hasDocsFolder = false
    try {
      const s = await stat(docsDir)
      hasDocsFolder = s.isDirectory()
    } catch {}

    const tree = await buildTree(projectDir, projectDir)

    if (tree.length > 0) {
      projects.push({ name, hasDocsFolder, tree })
    }
  }

  return projects
}

/**
 * Discover projects across every configured root (#113).
 *
 * The single-root walk above is unchanged and still does all the work — this runs
 * it per root and merges. The only non-obvious part is naming, and that is not
 * decided here: `projectNameFor` owns it, so discovery, the search index and the
 * path resolver cannot drift into three different answers about what a project is
 * called.
 *
 * Roots are visited in configured order, which fixes both the sidebar order and
 * which of two same-named projects keeps the bare name.
 */
export async function discoverAcrossRoots(roots: readonly string[]): Promise<ProjectInfo[]> {
  // One root is the installed base: skip the merge entirely so its behaviour is
  // not merely equivalent but literally the same code path.
  if (roots.length === 1) return discoverProjects(roots[0])

  const merged: ProjectInfo[] = []
  const taken = new Set<string>()

  for (const root of roots) {
    for (const project of await discoverProjects(root)) {
      const name = projectNameFor(roots, path.join(root, project.name), existsAsDir)
      // Null means the directory is not a direct child of a configured root, which
      // cannot happen for something discoverProjects just returned.
      if (name === null) continue
      if (taken.has(name)) {
        // Only reachable when a folder is literally named `<name>@<rootBasename>`
        // in an earlier root. Rare enough to report rather than invent a second
        // disambiguation scheme that would not survive the round-trip back to a
        // directory.
        console.warn(
          `vibedocs: hiding ${path.join(root, project.name)} — the name "${name}" is already taken. Rename either directory.`,
        )
        continue
      }
      taken.add(name)
      merged.push({ ...project, name })
    }
  }

  return merged
}

/** Sync existence probe for `projectNameFor`, which must stay usable from sync callers. */
function existsAsDir(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

export { buildTree as buildTreePublic }

/**
 * Convert an absolute filesystem path under PROJECTS_DIR to a project-relative
 * wire-format path: `<project>/<rel/path/to/file>`. Returns null if the
 * absolute path is not strictly under projectsDir, or resolves to projectsDir
 * itself (no project segment).
 *
 * This is the boundary helper for any code path that broadcasts file paths to
 * untrusted clients (e.g. WebSocket reload messages). Keep absolute paths
 * inside the process; emit only project-relative paths over the wire.
 */
export function toProjectRelativePath(
  absPath: string,
  projectsDir: string | readonly string[],
): string | null {
  const roots = typeof projectsDir === 'string' ? [projectsDir] : projectsDir

  for (const root of roots) {
    const rel = path.relative(root, absPath)
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue

    // Force POSIX separators so the wire format matches the frontend's
    // hash-routing convention regardless of host platform.
    const segments = rel.split(path.sep)
    // The project name must be the one the project list used, or the frontend
    // cannot match a reload against the document it has open.
    const project = projectNameFor(roots, path.join(root, segments[0]), existsAsDir)
    if (project === null) return null
    return [project, ...segments.slice(1)].join('/')
  }
  return null
}

export type FileTypeFilter = 'all' | 'markdown' | 'assets'

/**
 * Filter a file tree by file type.
 * - 'all': return tree unchanged
 * - 'markdown': keep only non-asset files; drop folders that end up empty
 * - 'assets': keep only asset files; drop folders that end up empty
 *
 * Pure function. Does not mutate input.
 */
export function filterTreeByType(nodes: FileNode[], mode: FileTypeFilter): FileNode[] {
  if (mode === 'all') return nodes

  const keepAsset = mode === 'assets'
  const result: FileNode[] = []

  for (const node of nodes) {
    if (node.type === 'folder') {
      const children = filterTreeByType(node.children || [], mode)
      if (children.length > 0) {
        result.push({ ...node, children })
      }
    } else {
      const isAsset = node.isAsset === true
      if (keepAsset ? isAsset : !isAsset) {
        result.push(node)
      }
    }
  }

  return result
}

/**
 * Coerce a raw query-param value into a valid FileTypeFilter.
 * Unknown / missing values fall back to 'all' so the API stays backward compatible.
 */
export function parseFileTypeFilter(raw: string | undefined): FileTypeFilter {
  return raw === 'markdown' || raw === 'assets' ? raw : 'all'
}

/**
 * Apply a file-type filter across all projects. Projects whose tree becomes
 * empty after filtering are dropped from the result.
 */
export function filterProjects(projects: ProjectInfo[], mode: FileTypeFilter): ProjectInfo[] {
  if (mode === 'all') return projects
  return projects
    .map((p) => ({ ...p, tree: filterTreeByType(p.tree, mode) }))
    .filter((p) => p.tree.length > 0)
}
