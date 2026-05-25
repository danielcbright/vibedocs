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
  const title = escapeHtml(opts.title)
  const bundleEntry = escapeAttr(opts.bundleEntry)
  const stylesheetTag = opts.stylesheet
    ? `<link rel="stylesheet" href="${escapeAttr(opts.stylesheet)}">`
    : ''
  const navHtml = renderNav(opts.navLinks)

  // Note: page.html is rehype-sanitize'd output from render.ts — safe to
  // embed verbatim. Nothing else here interpolates user-controlled HTML.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- SEO meta placeholders (slice #50): canonical, og:*, twitter:*, description -->
    <title>${title}</title>
    ${stylesheetTag}
  </head>
  <body>
    <div id="root">
${navHtml}<main data-vd-page-path="${escapeAttr(page.path)}">
${page.html}
</main>
    </div>
    <script type="module" src="${bundleEntry}"></script>
  </body>
</html>
`
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
