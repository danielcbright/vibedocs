import { renderMermaidElements, type RenderOptions } from './mermaid-render'

/**
 * Lazy-load the self-hosted mermaid package and render every `.mermaid`
 * element under `root`. Returns early (without importing mermaid) if there
 * are no diagrams on the page — keeps the first-load bundle slim for docs
 * that don't use diagrams.
 *
 * On a per-diagram render failure, the source is shown inside a `<pre>`
 * with a small label so the user still sees the intent. See
 * `renderMermaidElements` for the fallback behaviour.
 */
export async function renderMermaidIn(
  root: HTMLElement,
  options: RenderOptions,
): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'))
  if (nodes.length === 0) return

  const mod = await import('mermaid')
  const mermaid = mod.default
  await renderMermaidElements(nodes, mermaid as never, options)
}
