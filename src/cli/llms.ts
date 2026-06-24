// llms.txt generation for `vibedocs build` (issue #53). Pure, unit-testable
// string generator. `runBuild` (src/cli/build.ts) resolves the site's docs
// into `LlmsDoc` descriptors, calls `formatLlmsTxt`, and writes the result to
// `<out>/llms.txt`. The raw `.md.txt` mirror is the build CLI's job (it owns
// the FS); this module only shapes the index string.
//
// Schema follows llmstxt.org: an H1 (site name), a blockquote summary, then a
// `## Key documentation` section (curated keyDocs) and a `## Full docs` section
// (everything else, with keyDocs excluded so nothing is listed twice). Each
// link is `- [title](absolute-url): description` — the `: description` suffix
// is dropped when a doc has no description.
//
// Pure: same inputs → same string, no FS, no clock. The unit tests pin the
// exact output so a formatting regression is caught here, not in a brittle
// build-integration assertion.

import { normalizeBaseUrl } from './sitemap.js'

/** One documentation page, as the llms.txt index sees it. */
export interface LlmsDoc {
  /** Human-readable title (`[title](url)`). */
  title: string
  /** Clean URL for the page, e.g. `/` or `/docs/install/`. */
  url: string
  /** Optional one-line description rendered after the link. */
  description?: string
}

export interface FormatLlmsTxtOptions {
  /** Site name — the H1. */
  name: string
  /** One-paragraph site summary — the blockquote. */
  summary: string
  /** Curated docs, listed first under `## Key documentation`. */
  keyDocs: LlmsDoc[]
  /** Every doc in the site. keyDocs are excluded from `## Full docs`. */
  allDocs: LlmsDoc[]
  /** Site base URL — bare hostname (`example.com`) or full origin. */
  baseUrl: string
}

/** Join the normalized origin with a clean URL, collapsing the slash seam. */
function absoluteUrl(origin: string, url: string): string {
  return `${origin}/${url.replace(/^\/+/, '')}`
}

/** Render one doc as a markdown list item with an absolute link. */
function docLine(origin: string, doc: LlmsDoc): string {
  const link = `- [${doc.title}](${absoluteUrl(origin, doc.url)})`
  const desc = doc.description?.trim()
  return desc ? `${link}: ${desc}\n` : `${link}\n`
}

/** Render a `## <heading>` section with its doc list, or '' when empty. */
function section(origin: string, heading: string, docs: LlmsDoc[]): string {
  if (docs.length === 0) return ''
  return `## ${heading}\n\n` + docs.map((d) => docLine(origin, d)).join('') + '\n'
}

/**
 * Build an llmstxt.org-compliant index of the site's docs.
 *
 * The `## Full docs` section lists every doc in `allDocs` that is NOT already
 * in `keyDocs` (matched by URL) — so a curated keyDoc never appears twice.
 */
export function formatLlmsTxt(opts: FormatLlmsTxtOptions): string {
  const origin = normalizeBaseUrl(opts.baseUrl)
  const keyUrls = new Set(opts.keyDocs.map((d) => d.url))
  const fullDocs = opts.allDocs.filter((d) => !keyUrls.has(d.url))

  const header = `# ${opts.name}\n\n> ${opts.summary}\n\n`
  const key = section(origin, 'Key documentation', opts.keyDocs)
  const full = section(origin, 'Full docs', fullDocs)

  // header already ends with a blank line; sections each end with a trailing
  // blank line. Trim the document to a single terminating newline so the
  // output is stable regardless of which sections are present.
  return (header + key + full).replace(/\n+$/, '\n')
}
