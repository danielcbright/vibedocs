import { describe, it, expect, vi } from 'vitest'

// Controllable fake mermaid. `render` resolves with a marker SVG so the test
// can assert which node got written to. The shim is dynamic-imported by the
// loader, so mocking the module path is enough.
const renderCalls: Array<{ id: string; source: string }> = []
vi.mock('@/lib/mermaid-shim', () => ({
  getMermaid: async () => ({
    initialize: () => {},
    render: async (id: string, source: string) => {
      renderCalls.push({ id, source })
      return { svg: `<svg data-for="${source.trim()}"></svg>` }
    },
  }),
}))

import { renderMermaidIn } from '@/lib/mermaid-loader'

describe('renderMermaidIn (issue #152: stale-node race)', () => {
  it('renders the .mermaid nodes that are live AFTER the async import, not stale ones', async () => {
    // A root that initially holds one `.mermaid` node. We swap its contents
    // for a DIFFERENT `.mermaid` node before the dynamic mermaid import has a
    // chance to resolve — simulating React re-rendering the content div via
    // `dangerouslySetInnerHTML` while the ~600 KB chunk is still loading.
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = '<div class="mermaid">STALE</div>'

    const promise = renderMermaidIn(root, { theme: 'default' })
    // Microtask boundary: the loader has captured (or not) nodes and is now
    // awaiting the shim import. Replace the content with the live node.
    root.innerHTML = '<div class="mermaid">LIVE</div>'

    await promise

    // The bug wrote SVG into the detached STALE node and the live LIVE node
    // kept its raw source. The fix re-queries after the import, so LIVE renders.
    expect(renderCalls.map((c) => c.source.trim())).toContain('LIVE')
    expect(renderCalls.map((c) => c.source.trim())).not.toContain('STALE')

    const liveNode = root.querySelector('.mermaid')!
    expect(liveNode.querySelector('svg')).not.toBeNull()

    root.remove()
  })

  it('bails without importing mermaid when the root has no diagrams', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = '<p>no diagrams here</p>'
    const before = renderCalls.length
    await renderMermaidIn(root, { theme: 'default' })
    expect(renderCalls.length).toBe(before)
    root.remove()
  })

  it('renders nothing into a root that was detached during the import', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = '<div class="mermaid">DETACHED</div>'
    const before = renderCalls.length
    const promise = renderMermaidIn(root, { theme: 'default' })
    root.remove() // detach before the import resolves
    await promise
    // A detached root must not be rendered — its diagrams aren't visible anyway.
    expect(
      renderCalls.slice(before).map((c) => c.source.trim()),
    ).not.toContain('DETACHED')
  })
})
