/**
 * Render a batch of `<div class="mermaid">` elements in place.
 *
 * The renderer is split from the loader (see `renderMermaidIn`) so the
 * fallback / success behaviour can be unit-tested without a real DOM and
 * without the full mermaid bundle. Each element is rendered independently:
 * if one diagram fails to parse, only that block degrades to a `<pre>`
 * showing the original source — other diagrams on the page still render.
 */

export interface MermaidElementLike {
  textContent: string | null
  innerHTML: string
  removeAttribute(name: string): void
}

export interface MermaidApi {
  initialize(config: { startOnLoad?: boolean; theme?: string }): void
  render(id: string, source: string): Promise<{ svg: string }>
}

export interface RenderOptions {
  theme: 'default' | 'dark'
  /** Prefix for the synthetic ids passed to mermaid.render(). */
  idPrefix?: string
}

export async function renderMermaidElements(
  elements: MermaidElementLike[],
  mermaid: MermaidApi,
  options: RenderOptions,
): Promise<void> {
  mermaid.initialize({ startOnLoad: false, theme: options.theme })

  const prefix = options.idPrefix ?? 'mermaid-render'

  await Promise.all(
    elements.map(async (el, idx) => {
      const source = (el.textContent ?? '').trim()
      // `data-processed` is mermaid's own re-entry guard; clear it so a
      // theme switch / WebSocket reload can re-render the same node.
      el.removeAttribute('data-processed')

      const renderId = `${prefix}-${idx}`
      try {
        const { svg } = await mermaid.render(renderId, source)
        el.innerHTML = svg
      } catch {
        // Graceful degradation: show the original source so the reader still
        // sees the intent, plus a small label so they know the diagram
        // failed (rather than silently displaying raw mermaid syntax).
        el.innerHTML =
          '<div class="mermaid-fallback">' +
          '<span class="mermaid-fallback-label">Diagram failed to render</span>' +
          `<pre>${escapeHtml(source)}</pre>` +
          '</div>'
      } finally {
        // mermaid.render() attaches a scratch container `<div id="d<renderId>">`
        // to document.body and forgets to remove it when render throws. Without
        // this cleanup the orphan div containing mermaid's own "bomb" error SVG
        // becomes visible as fixed-positioned cruft on the page.
        const scratch = (typeof document !== 'undefined')
          ? document.getElementById(`d${renderId}`)
          : null
        scratch?.remove()
      }
    }),
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
