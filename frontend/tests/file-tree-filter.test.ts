import { describe, it, expect } from 'vitest'
import { matchesFilter } from '@/lib/file-tree-filter'
import type { FileNode } from '@/hooks/use-projects'

const TREE: FileNode = {
  name: 'docs',
  path: 'docs',
  type: 'folder',
  children: [
    { name: 'install.md', path: 'docs/install.md', type: 'file' },
    {
      name: 'guides',
      path: 'docs/guides',
      type: 'folder',
      children: [
        { name: 'observability.md', path: 'docs/guides/observability.md', type: 'file' },
      ],
    },
  ],
}

describe('matchesFilter', () => {
  it('matches on the node name, case-insensitively', () => {
    expect(matchesFilter(TREE, 'DOCS')).toBe(true)
    const leaf: FileNode = { name: 'Install.md', path: 'a/Install.md', type: 'file' }
    expect(matchesFilter(leaf, 'install')).toBe(true)
  })

  it('matches on the node path, not just the name', () => {
    const leaf: FileNode = { name: 'observability.md', path: 'docs/guides/observability.md', type: 'file' }
    expect(matchesFilter(leaf, 'guides')).toBe(true)
  })

  it('matches a folder when a descendant matches (recurses through children)', () => {
    // The folder name "docs" doesn't contain "observability", but a deep child does.
    const onlyDeepMatch: FileNode = {
      name: 'top',
      path: 'top',
      type: 'folder',
      children: [
        {
          name: 'mid',
          path: 'top/mid',
          type: 'folder',
          children: [{ name: 'deep.md', path: 'top/mid/deep.md', type: 'file' }],
        },
      ],
    }
    expect(matchesFilter(onlyDeepMatch, 'deep')).toBe(true)
  })

  it('returns false when neither the node nor any descendant matches', () => {
    expect(matchesFilter(TREE, 'nonexistent-xyz')).toBe(false)
  })

  it('returns false for a leaf file whose name and path do not match', () => {
    const leaf: FileNode = { name: 'README.md', path: 'README.md', type: 'file' }
    expect(matchesFilter(leaf, 'install')).toBe(false)
  })
})
