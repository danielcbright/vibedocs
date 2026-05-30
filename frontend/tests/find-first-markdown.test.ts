import { describe, it, expect } from 'vitest'
import { findFirstMarkdown } from '@/lib/find-first-markdown'
import type { FileNode } from '@/hooks/use-projects'

describe('findFirstMarkdown', () => {
  it('prefers README.md over alphabetically earlier markdown files at the same level', () => {
    // Real-world case: demo has CHANGELOG.md (alphabetically before README.md)
    // plus several other top-level markdown files. Tile-click should still land
    // on README.md, not CHANGELOG.md.
    const tree: FileNode[] = [
      { name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' },
      { name: 'CLAUDE.md', path: 'CLAUDE.md', type: 'file' },
      { name: 'CODE_OF_CONDUCT.md', path: 'CODE_OF_CONDUCT.md', type: 'file' },
      { name: 'CONTEXT.md', path: 'CONTEXT.md', type: 'file' },
      { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', type: 'file' },
      { name: 'LICENSE.md', path: 'LICENSE.md', type: 'file' },
      { name: 'NOTICES.md', path: 'NOTICES.md', type: 'file' },
      { name: 'README.md', path: 'README.md', type: 'file' },
    ]
    expect(findFirstMarkdown(tree)?.path).toBe('README.md')
  })

  it('falls back to the first markdown file when no README/index exists (regression guard)', () => {
    const tree: FileNode[] = [
      { name: 'ARCHITECTURE.md', path: 'ARCHITECTURE.md', type: 'file' },
      { name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' },
      { name: 'NOTES.md', path: 'NOTES.md', type: 'file' },
    ]
    expect(findFirstMarkdown(tree)?.path).toBe('ARCHITECTURE.md')
  })
})
