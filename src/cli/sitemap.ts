// Sitemap + robots.txt emission for `vibedocs build` (issue #54). Pure,
// unit-testable string generators. `runBuild` (src/cli/build.ts) resolves a
// base URL (from `--base-url` or `siteConfig.domain`), calls these, and writes
// `sitemap.xml` + `robots.txt` into the build output.
//
// Both functions are pure: same inputs → same string, no FS, no clock. The
// build-emission test asserts the files appear in <out>/; the unit tests below
// pin the exact strings so a formatting regression is caught here, not in a
// brittle integration assertion.

/** Minimal page shape the sitemap needs — a clean URL plus its frontmatter. */
export interface SitemapPage {
  /** Clean URL for the page, e.g. `/` or `/docs/install/`. */
  url: string
  /** Parsed frontmatter — `noindex: true` excludes the page from the sitemap. */
  frontmatter: Record<string, unknown>
}

export interface FormatSitemapOptions {
  pages: SitemapPage[]
  /** Site base URL — bare hostname (`example.com`) or full origin. */
  baseUrl: string
}

export interface FormatRobotsOptions {
  /** Site base URL — bare hostname (`example.com`) or full origin. */
  baseUrl: string
  /** Override the `Sitemap:` line; defaults to `<baseUrl>/sitemap.xml`. */
  sitemapUrl?: string
}

/**
 * Normalize a configured base URL into a protocol-prefixed origin with no
 * trailing slash. `siteConfig.domain` is a bare hostname (`example.com`); a
 * `--base-url` may already carry a protocol. Either way we end up with
 * `https://example.com` so URL composition is a plain concatenation.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/\/+$/, '')
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Join the normalized origin with a clean URL, collapsing the slash seam. */
function absoluteUrl(origin: string, url: string): string {
  return `${origin}/${url.replace(/^\/+/, '')}`
}

/**
 * Build a valid sitemap.xml from the rendered pages. Pages whose frontmatter
 * has `noindex: true` are excluded (grill decision #18). URLs are absolute,
 * composed from the normalized base URL.
 */
export function formatSitemap(opts: FormatSitemapOptions): string {
  const origin = normalizeBaseUrl(opts.baseUrl)
  const entries = opts.pages
    .filter((page) => page.frontmatter?.noindex !== true)
    .map((page) => {
      const loc = xmlEscape(absoluteUrl(origin, page.url))
      return `  <url>\n    <loc>${loc}</loc>\n  </url>\n`
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries +
    '</urlset>\n'
  )
}

/**
 * Build a permissive robots.txt that allows all crawlers and points them at
 * the sitemap. The `Sitemap:` line defaults to `<baseUrl>/sitemap.xml`.
 */
export function formatRobots(opts: FormatRobotsOptions): string {
  const origin = normalizeBaseUrl(opts.baseUrl)
  const sitemapUrl = opts.sitemapUrl ?? `${origin}/sitemap.xml`
  return `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`
}
