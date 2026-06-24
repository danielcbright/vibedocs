import { renderMermaidElements, type RenderOptions } from './mermaid-render'

/**
 * Lazy-load the self-hosted mermaid package and render every `.mermaid`
 * element under `root`. Returns early (without importing the shim — and
 * therefore without fetching the mermaid chunk) if there are no diagrams
 * on the page, so docs without diagrams pay zero mermaid bytes on first
 * load.
 *
 * The shim itself dynamic-imports `mermaid`, so the shim chunk has no
 * static reference to mermaid. That keeps the mermaid chunk out of the
 * entry chunk's static-import graph and out of Vite's modulepreload
 * hints — see issue #23 and the long-form comment in `mermaid-shim.ts`.
 *
 * The shim also smooths over a Rollup chunk-splitting bug that strips
 * the literal `default` re-export from `mermaid.core.mjs`, which broke
 * PR #22 (reverted in 31c7ab8). See `mermaid-shim.ts` for the full
 * story.
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

  // Two-step lazy-load: first the (tiny) shim, then the mermaid package
  // via the shim's `getMermaid()` async accessor. The double indirection
  // is what keeps the mermaid chunk out of the entry chunk's static
  // import graph — a top-level `import 'mermaid'` in the shim would
  // pull the 2.9 MB chunk into the static graph and Vite would either
  // preload it on every page or inline the shim into the entry chunk
  // and statically import mermaid from there. See issue #23.
  const { getMermaid } = await import('./mermaid-shim')
  const mermaid = await getMermaid()
  // `getMermaid()` returns `MermaidApi` (the same contract `mermaid-render`
  // owns), so no cast is needed — the types line up directly.
  await renderMermaidElements(nodes, mermaid, options)
}
