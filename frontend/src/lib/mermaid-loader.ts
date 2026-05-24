import { renderMermaidElements, type RenderOptions } from './mermaid-render'

/**
 * Lazy-load the self-hosted mermaid package and render every `.mermaid`
 * element under `root`. Returns early (without importing mermaid) if there
 * are no diagrams on the page — keeps the first-load bundle slim for docs
 * that don't use diagrams.
 *
 * Mermaid is reached via a small static-import shim (`mermaid-shim.ts`)
 * with a NAMED export rather than `default`, and is pinned to a single
 * lazy chunk via `manualChunks` in `vite.config.ts`. Both are load-bearing
 * — see the long-form comment below and `mermaid-shim.ts` for the
 * Vite/Rollup chunk-splitting bug that motivated issue #23 (PR #22 was
 * reverted in 31c7ab8 because the obvious `import('mermaid').default`
 * pattern silently broke in the production build).
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

  // Dynamic-import our shim (not 'mermaid' directly). The shim statically
  // re-exports a named `mermaid` binding (not `default`) so Rollup can't
  // pre-resolve the access to "this whole module's default value" and
  // then leave a dangling `.default` accessor in user code — exactly the
  // chunking bug that motivated issue #23 (PR #22, reverted in 31c7ab8).
  //
  // Concretely: `import mermaidNs from 'mermaid'` + `(await x).default`
  // gets transformed by Vite/Rollup into `f.<short>` + `.default`, where
  // `f.<short>` already IS mermaid_default — so the trailing `.default`
  // returns undefined. Using a NAMED export from our own shim sidesteps
  // that optimisation entirely; Rollup just forwards the named binding.
  const { mermaid } = await import('./mermaid-shim')
  if (!mermaid || typeof mermaid.render !== 'function') {
    // Defensive: if the bundling regresses again (the named shim binding
    // resolves to something other than the mermaid API object), throw
    // loudly rather than silently failing. The build-output test
    // `tests/mermaid-bundle.test.ts` should catch this before runtime,
    // but the runtime guard surfaces it if the test is bypassed.
    throw new Error(
      'mermaid shim resolved but the binding is missing or malformed; ' +
        'check `frontend/src/lib/mermaid-shim.ts` and the `manualChunks` ' +
        'config in `frontend/vite.config.ts` (see issue #23)',
    )
  }
  await renderMermaidElements(nodes, mermaid as never, options)
}
