import { describe, it, expect } from 'vitest'
import { countMarkdownDocs } from '@/components/project-picker'
import type { FileNode } from '@/hooks/use-projects'

describe('countMarkdownDocs', () => {
  it('returns 0 for an empty tree', () => {
    const tree: FileNode[] = []
    expect(countMarkdownDocs(tree)).toBe(0)
  })
})
