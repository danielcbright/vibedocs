// Hardcoded HTML page template for `vibedocs build` (slice #49).
//
// Pure function — takes a rendered page + bundle reference, returns a full
// HTML document string. Intentionally minimal: no theme tokens (slice #51),
// no SEO meta beyond <title> (slice #50), no edit-on-GitHub footer (slice
// #55). Later slices layer those concerns on top of this scaffolding.
//
// The shape mirrors `frontend/index.html` closely enough that the React
// bundle can mount into `#root` without extra glue, and includes a plain
// <nav> of <a> links so the built site degrades gracefully without JS (the
// nav targets are the same clean URLs the React SPA navigates to).

import type { HtmlPage } from '../render.js'
import type { HydrationPolicy, SiteConfig } from '../shared/site-config-types.js'
import { renderPwaHeadTags, type PwaHeadOptions } from './pwa.js'
import type { PageSeo } from './seo.js'

export interface NavLink {
  url: string
  label: string
}

export interface ComposePageOptions {
  /** URL of the built React bundle entry script (e.g. `/assets/index-abc.js`). */
  bundleEntry: string
  /** <title> for this page. Will be HTML-escaped. */
  title: string
  /** Optional <link rel=stylesheet> URL emitted in <head>. */
  stylesheet?: string
  /** Optional plain-link nav rendered ahead of content for no-JS fallback. */
  navLinks?: NavLink[]
  /**
   * Static-build hydration policy. Defaults to `'full'` (today's behaviour).
   * When `'minimal'`, the `<script type="module">` bootstrap tag is omitted.
   */
  hydration?: HydrationPolicy
  /**
   * Optional curated nav sections (from `siteConfig.nav.sections`). When set
   * AND `hydration === 'minimal'`, replaces the flat-link fallback with a
   * semantic nested-list nav (`<nav aria-label="Main navigation">`).
   */
  siteConfigNav?: SiteConfig['nav']
  /**
   * PWA install/offline metadata. When supplied, `composePageHtml` injects the
   * manifest link + theme-color + iOS meta into `<head>` and a tiny
   * `/sw-register.js` script — in BOTH hydration modes (the SW is the only JS
   * in `minimal` mode). Omit it to emit a non-PWA page (back-compat).
   */
  pwa?: PwaHeadOptions
  /**
   * Resolved per-page SEO meta (from `resolvePageSeo` in `./seo.ts`). When
   * supplied, `composePageHtml` emits `<meta name="description">`, Open Graph
   * (`og:title`/`og:description`/`og:image`/`og:url`), Twitter card tags, a
   * `<link rel="canonical">`, and — when `noindex` is set — a robots meta.
   * Omit it (or its optional fields) to emit a non-SEO page (back-compat).
   */
  seo?: PageSeo
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!)
}

/**
 * Escape an attribute value: same character set as text, just narrower
 * substitutions would also work. Kept identical for now — every char that
 * matters in a double-quoted attribute is in HTML_ESCAPES.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value)
}

export function composePageHtml(page: HtmlPage, opts: ComposePageOptions): string {
  const hydration: HydrationPolicy = opts.hydration ?? 'full'
  const title = escapeHtml(opts.title)
  const bundleEntry = escapeAttr(opts.bundleEntry)
  const stylesheetTag = opts.stylesheet
    ? `<link rel="stylesheet" href="${escapeAttr(opts.stylesheet)}">`
    : ''
  // Minimal mode prefers the curated nav (when supplied) — flat fallback only
  // when there's no `siteConfig.nav.sections`. Full mode keeps the flat nav as
  // a no-JS scaffold the React SPA replaces post-hydrate.
  const useCuratedNav =
    hydration === 'minimal' &&
    !!opts.siteConfigNav &&
    opts.siteConfigNav.sections.length > 0
  const navHtml = useCuratedNav
    ? renderCuratedNav(opts.siteConfigNav!.sections)
    : renderNav(opts.navLinks)
  // Minimal mode strips the bootstrap script — the SPA bundle isn't shipped
  // and there's nothing to load. CSS stays put: Shiki tokens, prose typography,
  // and table styles all live in the Vite-emitted stylesheet.
  const scriptTag =
    hydration === 'full'
      ? `<script type="module" src="${bundleEntry}"></script>`
      : ''

  // PWA: manifest + theme-color + iOS meta in <head>; SW registration script
  // before </body>. Both fire in full AND minimal mode — the static service
  // worker is the only JS minimal pages ship, so the register script is a
  // plain (non-module) <script> to keep the minimal-mode "no module script"
  // contract intact.
  const pwaHeadTags = opts.pwa ? '\n    ' + renderPwaHeadTags(opts.pwa) : ''
  const swRegisterTag = opts.pwa ? '<script src="/sw-register.js"></script>' : ''

  // Per-page SEO meta (#50): description, Open Graph, Twitter, canonical, and
  // the optional robots noindex. Emitted only when an `seo` struct is supplied.
  const seoTags = opts.seo ? '\n    ' + renderSeoTags(opts.seo) : ''

  // Note: page.html is rehype-sanitize'd output from render.ts — safe to
  // embed verbatim. Nothing else here interpolates user-controlled HTML.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>${seoTags}
    ${stylesheetTag}${pwaHeadTags}
  </head>
  <body>
    <div id="root">
${navHtml}<main data-vd-page-path="${escapeAttr(page.path)}">
${page.html}
</main>
    </div>
    ${scriptTag}${swRegisterTag}
  </body>
</html>
`
}

/**
 * Render the per-page SEO `<head>` tags from a resolved {@link PageSeo}.
 * Optional fields (`description`, `ogDescription`, `ogImage`, `twitterSite`)
 * emit nothing when absent. The robots noindex meta appears only when
 * `noindex` is set. All values are attribute-escaped — `seo.description` and
 * friends originate from author frontmatter, so they're untrusted.
 */
function renderSeoTags(seo: PageSeo): string {
  const tags: string[] = []
  if (seo.description) {
    tags.push(`<meta name="description" content="${escapeAttr(seo.description)}">`)
  }
  if (seo.noindex) {
    tags.push(`<meta name="robots" content="noindex">`)
  }
  tags.push(`<link rel="canonical" href="${escapeAttr(seo.canonical)}">`)
  tags.push(`<meta property="og:title" content="${escapeAttr(seo.ogTitle)}">`)
  if (seo.ogDescription) {
    tags.push(`<meta property="og:description" content="${escapeAttr(seo.ogDescription)}">`)
  }
  if (seo.ogImage) {
    tags.push(`<meta property="og:image" content="${escapeAttr(seo.ogImage)}">`)
  }
  tags.push(`<meta property="og:url" content="${escapeAttr(seo.canonical)}">`)
  tags.push(`<meta name="twitter:card" content="${escapeAttr(seo.twitterCard)}">`)
  if (seo.twitterSite) {
    tags.push(`<meta name="twitter:site" content="${escapeAttr(seo.twitterSite)}">`)
  }
  return tags.join('\n    ')
}

function renderNav(links: NavLink[] | undefined): string {
  if (!links || links.length === 0) return ''
  const items = links
    .map((l) => `        <li><a href="${escapeAttr(l.url)}">${escapeHtml(l.label)}</a></li>`)
    .join('\n')
  return `      <nav data-vd-fallback-nav>
        <ul>
${items}
        </ul>
      </nav>
`
}

/**
 * Semantic curated nav for `hydration === 'minimal'` pages with a
 * `siteConfig.nav.sections` configured. Mirrors the SPA's curated-nav
 * structure (section labels as `<h2>`, items as `<a>` inside nested `<ul>`)
 * so screen readers get a real navigation landmark and keyboard users get
 * sensible Tab order without any JS.
 *
 * Items are project-relative markdown paths (e.g. `README.md`,
 * `docs/install.md`); we map them to the same clean URLs the renderer
 * produces — README.md at the root → `/`, anything else → `/<path-without-md>/`.
 */
function renderCuratedNav(
  sections: ReadonlyArray<{ label: string; items: readonly string[] }>,
): string {
  if (sections.length === 0) return ''
  const sectionsHtml = sections
    .map((section) => {
      const itemsHtml = section.items
        .map((markdownPath) => {
          const url = curatedItemUrl(markdownPath)
          const label = curatedItemLabel(markdownPath)
          return `            <li><a href="${escapeAttr(url)}">${escapeHtml(label)}</a></li>`
        })
        .join('\n')
      return `        <li>
          <h2>${escapeHtml(section.label)}</h2>
          <ul>
${itemsHtml}
          </ul>
        </li>`
    })
    .join('\n')
  return `      <nav aria-label="Main navigation">
        <ul>
${sectionsHtml}
        </ul>
      </nav>
`
}

/**
 * Mirror of `buildPageUrl` in src/render.ts — kept in lockstep so curated-nav
 * links land on the same clean URLs the renderer emits per page.
 */
function curatedItemUrl(projectRelativePath: string): string {
  const noExt = projectRelativePath.replace(/\.(md|markdown)$/i, '')
  if (noExt === 'README' || noExt === 'index') return '/'
  if (noExt.endsWith('/README') || noExt.endsWith('/index')) {
    return '/' + noExt.replace(/\/(README|index)$/, '/')
  }
  return '/' + noExt + '/'
}

/**
 * Default label derivation for a curated-nav item — just the filename
 * without the markdown extension. The frontmatter-driven title slice (#50)
 * can layer a richer label resolver on top later; for now this matches what
 * a reader would expect when configuring `items: ['docs/install.md']`.
 */
function curatedItemLabel(projectRelativePath: string): string {
  const last = projectRelativePath.split('/').pop() ?? projectRelativePath
  return last.replace(/\.(md|markdown)$/i, '')
}
