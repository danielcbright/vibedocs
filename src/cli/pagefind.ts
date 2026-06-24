// Static-site full-text search for `vibedocs build` (issue #56).
//
// Two seams, mirroring the pwa.ts split:
//   1. Pure string generators (`renderPagefindHeadTags`, `renderPagefindUiTags`,
//      `resolveSearchEnabled`) — unit-tested, injected by `composePageHtml`.
//   2. One side-effecting indexer (`indexWithPagefind`) — runs Pagefind's
//      programmatic API over the built HTML and writes the `/pagefind/` bundle.
//
// Pagefind indexes the rendered HTML AFTER `runBuild` has written every page,
// producing a self-hosted `/pagefind/` directory (the WASM index + the
// `pagefind-ui.js`/`pagefind-ui.css` widget). The injected UI loads that
// bundle directly — it does NOT depend on the React SPA, so search works in
// BOTH hydration modes (the whole point: `minimal` pages ship no SPA but still
// get search).

import path from 'path'

/**
 * Resolve whether static-search is on. Defaults to `true` — a built docs site
 * wants search out of the box. A project opts out with `search: false` in its
 * `.vibedocs.config.ts`.
 */
export function resolveSearchEnabled(siteConfigSearch: boolean | undefined): boolean {
  return siteConfigSearch ?? true
}

/**
 * The `<head>` stylesheet link for the Pagefind UI. Emitted in both hydration
 * modes when search is enabled. Path is the conventional `/pagefind/` bundle
 * root the indexer writes to.
 */
export function renderPagefindHeadTags(): string {
  return '<link rel="stylesheet" href="/pagefind/pagefind-ui.css">'
}

/**
 * The search widget markup + bootstrap, injected before `</body>`. A single
 * mount `<div id="vd-search">`, the self-hosted Pagefind UI script, and a tiny
 * init that mounts `PagefindUI` on it.
 *
 * Deliberately plain (no `type="module"`, no reference to the SPA bundle or
 * `window.__VIBEDOCS_STATIC`) so it works identically in `minimal` mode where
 * the page ships no other JavaScript. `pagefind-ui.js` lazy-loads the WASM
 * index from `/pagefind/` only when the user actually searches, so diagram-
 * and search-free first paint pays nothing for the index itself.
 */
export function renderPagefindUiTags(): string {
  return `<div id="vd-search" class="vd-search"></div>
    <script src="/pagefind/pagefind-ui.js"></script>
    <script>
      window.addEventListener('DOMContentLoaded', function () {
        new PagefindUI({ element: '#vd-search', showSubResults: true })
      })
    </script>`
}

/**
 * The name of the bundle directory Pagefind writes into the output root. The
 * UI paths above (`/pagefind/...`) assume this.
 */
export const PAGEFIND_BUNDLE_DIR = 'pagefind'

export interface IndexWithPagefindOptions {
  /** When true, let Pagefind log its own progress to stderr. */
  verbose?: boolean
}

/**
 * Index the built HTML under `outDir` with Pagefind, writing the search bundle
 * to `<outDir>/pagefind/`. Uses Pagefind's programmatic Node API
 * (`createIndex` → `addDirectory` → `writeFiles`) rather than shelling out, so
 * there's no `npx`/network dependency and the binary resolves from the
 * installed `pagefind` package.
 *
 * The `pagefind` package is a devDependency and ships its own platform binary;
 * the dynamic import keeps it off the hot path for builds that disable search.
 */
export async function indexWithPagefind(
  outDir: string,
  opts: IndexWithPagefindOptions = {},
): Promise<{ pageCount: number }> {
  let pf: typeof import('pagefind')
  try {
    pf = await import('pagefind')
  } catch (err) {
    // `pagefind` is a devDependency; a production-only install (or a prod
    // `npm ci`) won't have it. Surface an actionable hint instead of a raw
    // ERR_MODULE_NOT_FOUND so the operator knows search needs the dev install.
    throw new Error(
      `pagefind is not installed — static search needs it. Run \`npm install\` (it's a ` +
        `devDependency), or set \`search: false\` in .vibedocs.config.ts to skip indexing. ` +
        `(${(err as Error).message})`,
    )
  }
  const { createIndex, close } = pf
  const { index } = await createIndex(opts.verbose ? { verbose: true } : undefined)
  if (!index) {
    throw new Error('pagefind: failed to create index')
  }
  try {
    const added = await index.addDirectory({ path: outDir })
    await index.writeFiles({ outputPath: path.join(outDir, PAGEFIND_BUNDLE_DIR) })
    return { pageCount: added.page_count }
  } finally {
    await close()
  }
}
