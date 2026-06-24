import { describe, it, expect } from 'vitest'
import {
  renderMermaidElements,
  type MermaidApi,
  type MermaidElementLike,
} from '../frontend/src/lib/mermaid-render.js'

// A lightweight stand-in for the bits of HTMLElement the renderer touches.
// Keeps the test independent of jsdom/happy-dom so the existing backend-only
// vitest config still works. Typed against `MermaidElementLike` (plus a
// `dataset` field the fake tracks) so the renderer's real element contract is
// exercised without `as any`.
function fakeElement(source: string) {
  const el: MermaidElementLike & { dataset: Record<string, string> } = {
    textContent: source,
    innerHTML: source,
    dataset: { processed: 'true' },
    removeAttribute(name: string) {
      if (name === 'data-processed') delete this.dataset.processed
    },
  }
  return el
}

describe('renderMermaidElements', () => {
  it("replaces each element's innerHTML with the rendered SVG on success", async () => {
    const el = fakeElement('graph LR; A-->B')
    const mermaid: MermaidApi = {
      initialize: () => {},
      render: async (_id: string, _src: string) => ({ svg: '<svg id="m1">ok</svg>' }),
    }

    await renderMermaidElements([el], mermaid, { theme: 'default' })

    expect(el.innerHTML).toBe('<svg id="m1">ok</svg>')
  })

  it('shows the original source in a <pre> with a "Diagram failed to render" label when mermaid.render throws', async () => {
    const source = 'graph BROKEN { not valid'
    const el = fakeElement(source)
    const mermaid: MermaidApi = {
      initialize: () => {},
      render: async () => {
        throw new Error('Parse error on line 1')
      },
    }

    await renderMermaidElements([el], mermaid, { theme: 'default' })

    expect(el.innerHTML).toContain('Diagram failed to render')
    expect(el.innerHTML).toMatch(/<pre>[\s\S]*graph BROKEN \{ not valid[\s\S]*<\/pre>/)
  })

  it('isolates failures: a broken diagram falls back without breaking sibling diagrams', async () => {
    const good = fakeElement('graph LR; A-->B')
    const bad = fakeElement('graph BROKEN')
    const mermaid: MermaidApi = {
      initialize: () => {},
      render: async (id: string) => {
        if (id.endsWith('-1')) throw new Error('boom')
        return { svg: '<svg>ok</svg>' }
      },
    }

    await renderMermaidElements([good, bad], mermaid, { theme: 'default' })

    expect(good.innerHTML).toBe('<svg>ok</svg>')
    expect(bad.innerHTML).toContain('Diagram failed to render')
  })

  it('passes the theme through to mermaid.initialize', async () => {
    const el = fakeElement('graph LR; A-->B')
    let receivedTheme: string | undefined
    const mermaid: MermaidApi = {
      initialize: (cfg: { theme?: string }) => { receivedTheme = cfg.theme },
      render: async () => ({ svg: '<svg/>' }),
    }

    await renderMermaidElements([el], mermaid, { theme: 'dark' })

    expect(receivedTheme).toBe('dark')
  })

  it('escapes HTML in the fallback source so a hostile or accidental tag does not break the DOM', async () => {
    const source = 'graph LR; A-->B <script>x</script>'
    const el = fakeElement(source)
    const mermaid: MermaidApi = {
      initialize: () => {},
      render: async () => { throw new Error('nope') },
    }

    await renderMermaidElements([el], mermaid, { theme: 'default' })

    expect(el.innerHTML).not.toContain('<script>')
    expect(el.innerHTML).toContain('&lt;script&gt;')
  })

  it("clears mermaid's `data-processed` flag so the same element can re-render after a theme switch", async () => {
    const el = fakeElement('graph LR; A-->B')
    let cleared = false
    const tracking: MermaidElementLike = {
      ...el,
      removeAttribute(name: string) {
        if (name === 'data-processed') cleared = true
      },
    }
    const mermaid: MermaidApi = {
      initialize: () => {},
      render: async () => ({ svg: '<svg/>' }),
    }

    await renderMermaidElements([tracking], mermaid, { theme: 'default' })

    expect(cleared).toBe(true)
  })
})
