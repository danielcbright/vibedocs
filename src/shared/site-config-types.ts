// Shared SiteConfig type — no Node-only deps, safe to import from the
// frontend bundle. The runtime loader (`src/site-config.ts`) re-exports this
// alongside its esbuild-driven `loadSiteConfig` so both halves of the app see
// the same shape.

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
}
