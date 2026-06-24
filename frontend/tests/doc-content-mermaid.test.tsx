import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

// Mock the lazy mermaid loader so the test asserts on the render INVOCATION
// (and the root it receives) without pulling in the real ~600 KB mermaid
// chunk. The mock also stamps a sentinel <svg> into each `.mermaid` node so a
// test can prove the rendered output isn't clobbered by a later React commit.
const renderMermaidIn = vi.fn(async (root: HTMLElement) => {
  root.querySelectorAll('.mermaid').forEach((el) => {
    el.innerHTML = '<svg data-rendered="1"></svg>'
  })
})
vi.mock('@/lib/mermaid-loader', () => ({
  renderMermaidIn: (...args: unknown[]) => renderMermaidIn(...(args as [HTMLElement])),
}))

// useRawDocument fetches raw markdown via the api client on mount; stub it so
// DocContent renders without touching the network.
vi.mock('@/hooks/use-raw-document', () => ({
  useRawDocument: () => ({
    contentRef: { current: '' },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import { DocContent } from '@/components/doc-content'

const HTML_WITH_MERMAID =
  '<p>intro</p><div class="mermaid">flowchart TD\n A--&gt;B</div>'

function tree(props: Partial<React.ComponentProps<typeof DocContent>>) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <DocContent
          html={HTML_WITH_MERMAID}
          loading={false}
          error={null}
          project="demo"
          docPath="docs/x.md"
          connected
          {...props}
        />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function renderDoc(props: Partial<React.ComponentProps<typeof DocContent>>) {
  return render(tree(props))
}

describe('DocContent mermaid rendering', () => {
  beforeEach(() => {
    renderMermaidIn.mockClear()
  })

  it('invokes renderMermaidIn with a root containing the .mermaid node', async () => {
    renderDoc({})
    expect(renderMermaidIn).toHaveBeenCalled()
    const root = renderMermaidIn.mock.calls[0][0] as HTMLElement
    expect(root.querySelectorAll('.mermaid').length).toBe(1)
  })

  // Regression for issue #152: rapid navigation away from and back to the
  // SAME document unmounts the content div (loading=true) then remounts it
  // with an IDENTICAL html string. Because the original effect keyed only on
  // `[html, resolvedTheme]`, React's Object.is(html, html) === true skipped
  // the re-run, so the freshly-mounted .mermaid divs kept their raw source
  // and never rendered to SVG. The fix must re-render on every content mount.
  it('re-invokes renderMermaidIn after an unmount/remount with identical html', async () => {
    const { rerender } = renderDoc({})
    const afterMount = renderMermaidIn.mock.calls.length
    expect(afterMount).toBeGreaterThanOrEqual(1)

    // Navigate away: loading flips true → the content div unmounts.
    act(() => {
      rerender(tree({ loading: true }))
    })
    // Navigate back to the SAME doc: loading false again, identical html.
    act(() => {
      rerender(tree({ loading: false }))
    })

    // The remounted .mermaid node must get a fresh render pass — this is the
    // call the buggy `[html]`-keyed effect skipped (identical html string).
    expect(renderMermaidIn.mock.calls.length).toBeGreaterThan(afterMount)
    const lastRoot = renderMermaidIn.mock.calls.at(-1)![0] as HTMLElement
    expect(lastRoot.querySelectorAll('.mermaid').length).toBe(1)
  })

  it('re-renders the in-place node when html changes without a remount', () => {
    const { rerender } = renderDoc({})
    const afterMount = renderMermaidIn.mock.calls.length
    // Same mounted div, new html (e.g. WebSocket live-reload of the open doc).
    act(() => {
      rerender(
        tree({ html: '<div class="mermaid">sequenceDiagram\n A->>B: hi</div>' }),
      )
    })
    expect(renderMermaidIn.mock.calls.length).toBeGreaterThan(afterMount)
  })

  // The core issue #152 failure in the browser: mermaid renders SVG into the
  // `.mermaid` nodes, then a *trailing* React commit re-applies the SAME html
  // via `dangerouslySetInnerHTML`, wiping the SVG back to raw source. The fix
  // sets content imperatively, so React never owns (or clobbers) those nodes —
  // a parent re-render with identical html must leave the rendered SVG intact.
  it('keeps the rendered SVG when the parent re-renders with identical html', () => {
    const { container, rerender } = renderDoc({})
    const mer = container.querySelector('.mermaid')!
    expect(mer.querySelector('svg[data-rendered]')).not.toBeNull()

    // A trailing parent re-render with the SAME html (the clobber trigger).
    act(() => {
      rerender(tree({ connected: false }))
    })

    const merAfter = container.querySelector('.mermaid')!
    expect(merAfter.querySelector('svg[data-rendered]')).not.toBeNull()
    expect(merAfter.textContent).not.toContain('flowchart')
  })
})
