/**
 * Async accessor for the `mermaid` npm package.
 *
 * Why this file exists (two load-bearing reasons):
 *
 * 1. Lazy loading must remain LAZY.
 *    The previous version of this shim used a top-level
 *      `import mermaidDefault from 'mermaid'`
 *    statement. Even though the shim itself is dynamic-imported by
 *    `mermaid-loader.ts`, that static import made mermaid statically
 *    reachable from the shim chunk. Vite then either (a) emitted a
 *    `<link rel="modulepreload">` for the mermaid chunk in index.html,
 *    or (b) inlined the shim into the entry chunk and statically
 *    imported mermaid from there — either way fetching the full
 *    ~2.9 MB mermaid bundle on every page load, even on docs with zero
 *    diagrams. See issue #23.
 *
 *    Switching to a dynamic `await import('mermaid')` inside the async
 *    function below removes mermaid from the shim's static import
 *    graph entirely. Rollup treats `'mermaid'` as a separate chunk
 *    boundary, so the mermaid chunk is now only fetched on first call
 *    to `getMermaid()`.
 *
 * 2. The Rollup default-export chunking bug (issue #23 / PR #22).
 *    Mermaid's package entry ends with `export { mermaid_default as default }`.
 *    When consumer code does
 *      `const mermaid = (await import('mermaid')).default`
 *    Rollup's chunk transform rewrites this to `(await ...).default`
 *    where the `.default` access lands on a value that is ALREADY the
 *    resolved mermaid object — so the trailing `.default` returns
 *    `undefined` and every diagram silently fails. That was the bug
 *    that got PR #22 reverted in 31c7ab8.
 *
 *    The runtime guard `mod.default ?? mod` in `getMermaid()` papers
 *    over both shapes: when Rollup's transform leaves `.default`
 *    accessible we use it; when it strips it we fall back to the
 *    whole module namespace object (which IS the mermaid API after
 *    the chunk-resolution dance). This is robust across Vite/Rollup
 *    versions and across whatever sub-module chunking Rollup decides
 *    on.
 */

/** The minimal mermaid surface the loader uses. */
export interface MermaidApiLike {
  initialize(config: { startOnLoad?: boolean; theme?: string }): void
  render(id: string, source: string): Promise<{ svg: string }>
}

export async function getMermaid(): Promise<MermaidApiLike> {
  // Dynamic import — Rollup treats this as a chunk boundary, so the
  // mermaid chunk is not in this module's static import graph. That
  // is what preserves lazy loading. See top-of-file comment.
  const mod = (await import('mermaid')) as unknown as Record<string, unknown>
  // Runtime default-shape guard (see top-of-file comment). After
  // Rollup chunking, `mod.default` may be the mermaid API, undefined,
  // or the namespace itself depending on chunk graph. Fall back to
  // the namespace itself if `.default` is missing.
  const candidate = (mod.default ?? mod) as MermaidApiLike | undefined
  if (
    !candidate ||
    typeof (candidate as Partial<MermaidApiLike>).render !== 'function' ||
    typeof (candidate as Partial<MermaidApiLike>).initialize !== 'function'
  ) {
    throw new Error(
      'mermaid module resolved but the binding is missing the expected ' +
        'API surface; the Vite/Rollup chunk-splitting transform may have ' +
        'regressed (see issue #23 and the long-form comment in ' +
        '`frontend/src/lib/mermaid-shim.ts`)',
    )
  }
  return candidate
}
