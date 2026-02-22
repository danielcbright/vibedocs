import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { PROJECTS_DIR } from './discovery.js'

interface IndexEntry {
  project: string
  path: string
  filename: string
  content: string // lowercase for matching
}

let index: IndexEntry[] = []

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', 'tmp', 'temp', '_archived', 'vibedocs',
  '.project-template', 'test-projects',
])

async function collectFiles(dir: string, projectName: string, projectRoot: string): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = []
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return entries
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
      const sub = await collectFiles(fullPath, projectName, projectRoot)
      entries.push(...sub)
    } else if (name.endsWith('.md') || name.endsWith('.markdown')) {
      if (s.size === 0) continue
      try {
        const content = await readFile(fullPath, 'utf-8')
        const relPath = path.relative(projectRoot, fullPath)
        entries.push({
          project: projectName,
          path: relPath,
          filename: name,
          content: content.toLowerCase(),
        })
      } catch {
        // Skip unreadable files
      }
    }
  }

  return entries
}

export async function buildSearchIndex(): Promise<void> {
  const newIndex: IndexEntry[] = []
  let projects: string[]

  try {
    projects = await readdir(PROJECTS_DIR)
  } catch {
    index = []
    return
  }

  for (const name of projects.sort()) {
    if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue
    const projectDir = path.join(PROJECTS_DIR, name)

    try {
      const s = await stat(projectDir)
      if (!s.isDirectory()) continue
    } catch {
      continue
    }

    const files = await collectFiles(projectDir, name, projectDir)
    newIndex.push(...files)
  }

  index = newIndex
  console.log(`  🔍 Search index: ${index.length} files indexed`)
}

export interface SearchResult {
  project: string
  path: string
  filename: string
  snippet: string
}

export function search(query: string, maxResults = 20): SearchResult[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const results: SearchResult[] = []

  for (const entry of index) {
    const pos = entry.content.indexOf(q)
    if (pos === -1) continue

    // Extract snippet with context
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
}
