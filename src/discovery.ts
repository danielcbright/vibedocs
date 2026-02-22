import { readdir, stat } from 'fs/promises'
import path from 'path'

export const PROJECTS_DIR = '/home/dbright/claudebot/projects'

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', 'tmp', 'temp', '_archived', 'vibedocs',
  '.project-template', 'test-projects',
])

const EXCLUDED_ROOT_MD = new Set([
  // Non-documentation files that happen to be markdown
])

export interface FileNode {
  name: string
  path: string  // relative to project root
  type: 'file' | 'folder'
  children?: FileNode[]
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
    } else if (entry.endsWith('.md') || entry.endsWith('.markdown')) {
      if (s.size === 0) continue  // skip empty files
      nodes.push({ name: entry, path: relPath, type: 'file' })
    }
  }

  return nodes
}

async function getRootMarkdownFiles(projectDir: string): Promise<FileNode[]> {
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return []
  }

  const files: FileNode[] = []
  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue
    if (!entry.endsWith('.md') && !entry.endsWith('.markdown')) continue
    if (EXCLUDED_ROOT_MD.has(entry)) continue

    const fullPath = path.join(projectDir, entry)
    try {
      const s = await stat(fullPath)
      if (s.isFile() && s.size > 0) {
        files.push({ name: entry, path: entry, type: 'file' })
      }
    } catch {
      continue
    }
  }
  return files
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
    let tree: FileNode[] = []

    // Always include root-level .md files (CLAUDE.md, README.md, etc.)
    const rootFiles = await getRootMarkdownFiles(projectDir)

    try {
      const s = await stat(docsDir)
      if (s.isDirectory()) {
        hasDocsFolder = true
        const docsChildren = await buildTree(docsDir, projectDir)
        // Root files first, then docs/ as an expandable folder
        tree = [
          ...rootFiles,
          ...(docsChildren.length > 0
            ? [{ name: 'docs', path: 'docs', type: 'folder' as const, children: docsChildren }]
            : []),
        ]
      }
    } catch {
      // No docs/ folder — root-level .md files only
      tree = rootFiles
    }

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
