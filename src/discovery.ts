import { readdir, stat } from 'fs/promises'
import path from 'path'
import type { SiteConfig } from './site-config.js'
import { EXCLUDED_DIRS } from './excluded-paths.js'

export const PROJECTS_DIR = process.env.VIBEDOCS_ROOT || process.cwd()

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
      const isMd = entry.endsWith('.md') || entry.endsWith('.markdown')
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

export async function discoverProjects(): Promise<ProjectInfo[]> {
  let entries: string[]
  try {
    entries = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }

  const projects: ProjectInfo[] = []

  for (const name of entries.sort()) {
    if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue

    const projectDir = path.join(PROJECTS_DIR, name)
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
  projectsDir: string,
): string | null {
  const rel = path.relative(projectsDir, absPath)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null
  }
  // Force POSIX separators so the wire format matches the frontend's
  // hash-routing convention regardless of host platform.
  return rel.split(path.sep).join('/')
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
