import { readdir, stat } from 'fs/promises'
import path from 'path'
import { VibedocsError } from './errors.js'

export const PROJECTS_DIR = process.env.VIBEDOCS_ROOT || process.cwd()

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', 'tmp', 'temp', '_archived',
  '.project-template', 'test-projects',
])

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

/**
 * Resolve a markdown document path inside a project. Throws
 * `VibedocsError('traversal')` if the path escapes the project root and
 * `VibedocsError('invalid')` if the file isn't a markdown extension.
 */
export function resolveDocPath(project: string, docPath: string): string {
  // Sanitize: prevent path traversal
  const projectDir = path.join(PROJECTS_DIR, project)
  const resolved = path.resolve(projectDir, docPath)

  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    throw new VibedocsError('traversal', 'Invalid path')
  }
  if (!resolved.endsWith('.md') && !resolved.endsWith('.markdown')) {
    throw new VibedocsError('invalid', 'Invalid path')
  }

  return resolved
}

export { buildTree as buildTreePublic }

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
