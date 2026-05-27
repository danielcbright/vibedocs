// Shared SiteConfig type — no Node-only deps, safe to import from the
// frontend bundle. The runtime loader (`src/site-config.ts`) re-exports this
// alongside its esbuild-driven `loadSiteConfig` so both halves of the app see
// the same shape.

/**
 * Hydration policy for static builds (`vibedocs build`). Live mode ignores
 * this — the React SPA always hydrates when served via `src/server.ts`.
 *
 * - `full`     (default): copy the SPA bundle and emit `<script type="module">`.
 *                         Reader gets the same interactive app the live server
 *                         serves (search, theme toggle, mermaid, copy-md,
 *                         mobile drawer).
 * - `minimal`: skip the SPA bundle and the bootstrap script tag. The page is
 *              the rendered article HTML plus a server-rendered nav and CSS.
 *              Loses search/theme-toggle/mermaid/copy-md/mobile-drawer but
 *              ships ~500 KB less JS — the right call for public docs sites
 *              like argus.io.
 */
export type HydrationPolicy = 'full' | 'minimal'

export interface SiteConfig {
  name: string
  domain: string
  description: string
  theme: {
    tokens: Record<string, string>
    logo?: string
    favicon?: string
    css?: string
  }
  nav?: {
    sections: Array<{ label: string; items: string[] }>
  }
  llms: {
    summary: string
    keyDocs: string[]
  }
  seo?: {
    ogImage?: string
    twitterHandle?: string
  }
  editOnGitHub?: {
    repo: string
    branch: string
    rootPath: string
  }
  /** Static-build hydration policy; defaults to `'full'` when absent. */
  hydration?: HydrationPolicy
}
