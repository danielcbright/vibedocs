import { describe, it, expect } from 'vitest'
import { filterTreeByType } from '../src/discovery.js'
import type { FileNode } from '../src/discovery.js'

// Sample tree representing a project with mixed markdown + assets,
// including an asset-only folder and a deeply nested mix.
function sampleTree(): FileNode[] {
  return [
    {
      name: 'docs',
      path: 'docs',
      type: 'folder',
      children: [
        { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
        { name: 'screenshot.png', path: 'docs/screenshot.png', type: 'file', isAsset: true },
        {
          name: 'images',
          path: 'docs/images',
          type: 'folder',
          children: [
            { name: 'logo.svg', path: 'docs/images/logo.svg', type: 'file', isAsset: true },
          ],
        },
      ],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ]
}

describe('filterTreeByType', () => {
  it("returns the tree unchanged for mode='all'", () => {
    const tree = sampleTree()
    expect(filterTreeByType(tree, 'all')).toEqual(tree)
  })

  it("for mode='markdown' keeps only markdown files and drops empty folders", () => {
    const filtered = filterTreeByType(sampleTree(), 'markdown')

    // README.md and docs/ should remain. docs/images/ is asset-only so it disappears.
    expect(filtered).toHaveLength(2)
    const docs = filtered.find((n) => n.name === 'docs')!
    expect(docs).toBeDefined()
    expect(docs.children!.map((c) => c.name)).toEqual(['guide.md'])
    expect(filtered.find((n) => n.name === 'README.md')).toBeDefined()
  })

  it("for mode='assets' keeps only non-markdown files and drops empty folders", () => {
    const filtered = filterTreeByType(sampleTree(), 'assets')

    // README.md is markdown so it disappears at the root. docs/ remains because images/ has assets.
    expect(filtered.find((n) => n.name === 'README.md')).toBeUndefined()
    const docs = filtered.find((n) => n.name === 'docs')!
    expect(docs).toBeDefined()
    // docs/guide.md is markdown → gone. docs/screenshot.png + docs/images/logo.svg remain.
    const docChildNames = docs.children!.map((c) => c.name).sort()
    expect(docChildNames).toEqual(['images', 'screenshot.png'])
    const images = docs.children!.find((c) => c.name === 'images')!
    expect(images.children!.map((c) => c.name)).toEqual(['logo.svg'])
  })

  it("for mode='markdown' drops a folder whose children are all assets", () => {
    const tree: FileNode[] = [
      {
        name: 'assets-only',
        path: 'assets-only',
        type: 'folder',
        children: [
          { name: 'a.png', path: 'assets-only/a.png', type: 'file', isAsset: true },
          { name: 'b.jpg', path: 'assets-only/b.jpg', type: 'file', isAsset: true },
        ],
      },
    ]
    expect(filterTreeByType(tree, 'markdown')).toEqual([])
  })

  it("for mode='assets' drops a folder whose children are all markdown", () => {
    const tree: FileNode[] = [
      {
        name: 'docs-only',
        path: 'docs-only',
        type: 'folder',
        children: [
          { name: 'a.md', path: 'docs-only/a.md', type: 'file' },
          { name: 'b.markdown', path: 'docs-only/b.markdown', type: 'file' },
        ],
      },
    ]
    expect(filterTreeByType(tree, 'assets')).toEqual([])
  })

  it('does not mutate the input tree', () => {
    const tree = sampleTree()
    const snapshot = JSON.parse(JSON.stringify(tree))
    filterTreeByType(tree, 'markdown')
    expect(tree).toEqual(snapshot)
  })
})
