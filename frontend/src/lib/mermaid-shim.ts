/**
 * Static-import shim around the `mermaid` npm package.
 *
 * Why this file exists: when consumer code does
 *   const mod = await import('mermaid'); mod.default.initialize(...)
 * Vite's Rollup transforms the access pattern at the chunk boundary and
 * the literal `default` re-export from `mermaid.core.mjs` gets dropped,
 * so `mod.default` is `undefined` at runtime — see issue #23 and the
 * reverted PR #22.
 *
 * Wrapping mermaid in our own module that *statically* imports it and
 * *statically* re-exports the default preserves the default export
 * through the chunk boundary. The shim is then dynamically imported by
 * `mermaid-loader.ts`, so mermaid is still split into its own lazy
 * chunk (~1MB) and docs without diagrams pay no first-load cost.
 *
 * Pair this with `manualChunks` in `vite.config.ts` to keep mermaid's
 * own internals in a single named chunk; together they make the
 * "lazy + working" combination robust against future Rollup changes.
 */
import mermaidDefault from 'mermaid'

/**
 * Re-exported as a NAMED binding (not default). The consumer in
 * `mermaid-loader.ts` destructures `{ mermaid }` from the dynamic import,
 * which avoids the Vite/Rollup chunk-splitting optimisation that drops
 * the `default` re-export.
 */
export const mermaid = mermaidDefault
