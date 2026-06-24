// VibeDocs site config — annotated example.
//
// Copy this to your project root as `.vibedocs.config.ts` and trim it down to
// what you need. Only a handful of fields are REQUIRED (marked below); the rest
// are optional and can be deleted entirely.
//
// `vibedocs build` transpiles this file with esbuild at build time and reads
// the default export. The `vibedocs/config` import is resolved by vibedocs
// itself — you do NOT need vibedocs installed as a runtime dep for this import
// to work during a build.
//
// Every field is validated at build time. A typo'd or wrong-typed field fails
// the build with a message naming the offending path (e.g. "theme.tokens").

import { defineSite } from 'vibedocs/config'

export default defineSite({
  // ── REQUIRED ──────────────────────────────────────────────────────────────

  // Site name. Used as the PWA name and as a fallback document title.
  name: 'My Docs',

  // Bare hostname (no scheme) the site is served from. Feeds sitemap.xml,
  // robots.txt, and absolute URLs. A `--base-url` CLI flag, when passed,
  // overrides this. Use it when one config serves multiple environments.
  domain: 'docs.example.com',

  // One-line description. Used for the <meta name="description"> tag and the
  // PWA manifest description.
  description: 'Documentation for the Example project.',

  // Theme block is required; only `tokens` inside it is required.
  theme: {
    // CSS custom-property overrides injected into every page. Keys are CSS
    // variable names, values are CSS values. `--primary` doubles as the PWA
    // theme color when it's a hex value (oklch()/HSL-triple tokens are ignored
    // for theme_color and fall back to the vibedocs default).
    tokens: {
      '--primary': '#8852e0',
    },

    // OPTIONAL — path (relative to the project root) to a logo image shown in
    // the sidebar header. Delete if you don't have one.
    // logo: 'assets/logo.svg',

    // OPTIONAL — path to a favicon. Delete to use the vibedocs default.
    // favicon: 'assets/favicon.ico',

    // OPTIONAL — path to an extra CSS file appended after the theme tokens, for
    // styling that doesn't fit a single custom property.
    // css: 'assets/custom.css',
  },

  // LLM-discovery metadata. Required: drives the generated llms.txt so AI
  // crawlers get a curated summary + entry points instead of guessing.
  llms: {
    // Plain-prose summary of what this site documents.
    summary: 'Guides and reference for the Example project.',
    // The handful of docs an LLM should read first, as repo-relative paths.
    keyDocs: ['README.md', 'docs/getting-started.md'],
  },

  // ── OPTIONAL ──────────────────────────────────────────────────────────────

  // Static-build hydration policy. Omit (or set 'full') for the interactive
  // SPA (search via Ctrl+K, theme toggle, mermaid diagrams, copy-md, mobile
  // drawer). Set 'minimal' to ship ~500 KB less JS per page — server-rendered
  // article + nav + CSS only, no client search/theme toggle. Pick 'minimal'
  // for public docs where most readers land on one page and leave.
  // A `--hydration` CLI flag overrides this field.
  // hydration: 'full',

  // Explicit navigation. When set, the sidebar (and minimal-mode server nav)
  // renders these sections in order instead of auto-deriving the tree. `items`
  // are repo-relative markdown paths.
  // nav: {
  //   sections: [
  //     { label: 'Getting Started', items: ['docs/install.md', 'docs/quickstart.md'] },
  //     { label: 'Reference', items: ['docs/api.md'] },
  //   ],
  // },

  // SEO metadata for social cards.
  // seo: {
  //   ogImage: 'assets/og-image.png', // repo-relative path to the Open Graph image
  //   twitterHandle: '@example',       // including the leading @
  // },

  // "Edit on GitHub" link rendered per page. `rootPath` is the path within the
  // repo that maps to the site root (use '.' if docs live at the repo root).
  // editOnGitHub: {
  //   repo: 'example-org/example-repo',
  //   branch: 'main',
  //   rootPath: '.',
  // },
})
