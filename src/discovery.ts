import { readdir, stat } from 'fs/promises'
import path from 'path'

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
      if (children.length > 0) {
        nodes.push({ name: entry, path: relPath, type: 'folder', children })
      }
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

export function resolveDocPath(project: string, docPath: string): string | null {
  // Sanitize: prevent path traversal
  const projectDir = path.join(PROJECTS_DIR, project)
  const resolved = path.resolve(projectDir, docPath)

  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) return null
  if (!resolved.endsWith('.md') && !resolved.endsWith('.markdown')) return null

  return resolved
}

export { buildTree as buildTreePublic }
