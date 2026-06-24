// Per-page SEO meta resolution for `vibedocs build` (issue #50).
//
// Pure, unit-tested string logic. Given a rendered page, its parsed
// frontmatter, the optional site config, and the resolved site base URL,
// `resolvePageSeo` produces the concrete values `composePageHtml` emits into
// `<head>`: title, description, Open Graph + Twitter tags, canonical URL, and
// the `noindex` flag.
//
// Resolution precedence (grill decision #18):
//   title       → frontmatter.title → first <h1> text → filename
//   description → frontmatter.description → siteConfig.description
//   og:image    → frontmatter.og_image → siteConfig.seo.ogImage
//   canonical   → <baseUrl> + page.url
//   noindex     → frontmatter.noindex === true || frontmatter.draft === true
//
// Frontmatter `title:` sets `<title>` only; the body H1 the author wrote is
// untouched (no automatic H1 generation/replacement).

import type { HtmlPage } from '../render.js'
import type { SiteConfig } from '../shared/site-config-types.js'

export interface ResolvePageSeoOptions {
  page: HtmlPage
  siteConfig: SiteConfig | null
  /** Normalized site origin, e.g. `https://docs.example.com` (no trailing slash). */
  baseUrl: string
}

/**
 * The concrete SEO values for one page. `composePageHtml` reads this struct
 * and emits the corresponding tags — undefined fields emit nothing.
 */
export interface PageSeo {
  /** `<title>` text — the page part only; the template appends ` — <site name>`. */
  title: string
  /** `<meta name="description">` content. Undefined → no description tag. */
  description?: string
  /** `og:title` — defaults to `title`. */
  ogTitle: string
  /** `og:description` — defaults to `description`. */
  ogDescription?: string
  /** `og:image` — absolute or author-supplied URL. Undefined → no og:image. */
  ogImage?: string
  /** `og:url` / `<link rel="canonical">` — absolute URL for this page. */
  canonical: string
  /** `twitter:card` — `summary_large_image` when an og:image is present, else `summary`. */
  twitterCard: 'summary' | 'summary_large_image'
  /** `twitter:site` — the configured `@handle`. Undefined → no twitter:site tag. */
  twitterSite?: string
  /** When true, emit `<meta name="robots" content="noindex">` and exclude from sitemap. */
  noindex: boolean
}

/** Read a frontmatter key as a non-empty trimmed string, else undefined. */
function fmString(
  frontmatter: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = frontmatter[key]
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Derive the page title from its rendered HTML: first `<h1>` inner text with
 * tags stripped (the renderer wraps headings in `<a class="heading-anchor">`).
 * Returns undefined when there's no H1.
 */
function titleFromHtml(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m) return undefined
  const text = m[1]!.replace(/<[^>]+>/g, '').trim()
  return text.length > 0 ? text : undefined
}

/** Filename (no extension) from a project-relative POSIX path. */
function filenameTitle(posixPath: string): string {
  const last = posixPath.split('/').pop() ?? posixPath
  return last.replace(/\.(md|markdown)$/i, '')
}

export function resolvePageSeo(opts: ResolvePageSeoOptions): PageSeo {
  const { page, siteConfig, baseUrl } = opts
  const fm = page.frontmatter ?? {}

  const title =
    fmString(fm, 'title') ?? titleFromHtml(page.html) ?? filenameTitle(page.path)

  const description =
    fmString(fm, 'description') ??
    (siteConfig?.description?.trim() || undefined)

  const ogImage = fmString(fm, 'og_image') ?? siteConfig?.seo?.ogImage

  const twitterSite = siteConfig?.seo?.twitterHandle

  const noindex = fm.noindex === true || fm.draft === true

  return {
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogImage,
    canonical: absoluteUrl(baseUrl, page.url),
    twitterCard: ogImage ? 'summary_large_image' : 'summary',
    twitterSite,
    noindex,
  }
}

/** Join a normalized origin with a clean URL, collapsing the slash seam. */
function absoluteUrl(origin: string, url: string): string {
  return `${origin.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}
