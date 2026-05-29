// Markdown processor factory.
//
// Single, testable seam for the unified() pipeline used by both the live
// render route and the build CLI. Extracted from `renderMarkdownForPage`
// in `src/render.ts` so that pipeline behaviour (plugin ordering,
// mode-aware URL rewriting, sanitize schema) can be exercised directly
// without spinning up a full RenderResult round-trip.
//
// The factory is intentionally per-call: the rewrite plugin captures
// per-page state (currentDocPath, collector). Shiki initialisation is the
// slow part of the pipeline; it's amortised by the @shikijs/rehype
// singleton highlighter cache, so building a fresh `unified()` instance
// per page is cheap in practice.
//
// Issue #85.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'
import rehypeShiki from '@shikijs/rehype'
import rehypeSanitize from 'rehype-sanitize'
import {
  remarkMermaid,
  rehypeWrapTables,
  sanitizeSchema,
} from './markdown-plugins.js'
import { rehypeRewriteUrls, type RewriteOptions } from './url-rewriter.js'

/**
 * Options that configure the per-page rewrite plugin. The processor is
 * otherwise mode-agnostic — Shiki, sanitize, autolink headings etc. all
 * behave identically across live and build modes.
 */
export type CreateMarkdownProcessorOptions = RewriteOptions

/**
 * Build a unified() processor wired with remark-parse, remark-gfm,
 * remark-mermaid, remark-rehype, rehype-shiki, rehype-wrap-tables,
 * rehype-slug, rehype-autolink-headings, the per-page URL rewriter, and
 * finally rehype-sanitize + rehype-stringify.
 *
 * Plugin order matters: URL rewriting runs BEFORE sanitize so that the
 * sanitizer scrubs whatever URLs the rewriter emits, not the raw
 * author-supplied ones.
 */
export function createMarkdownProcessor(
  options: CreateMarkdownProcessorOptions,
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaid)
    .use(remarkRehype)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      fallbackLanguage: 'text',
    })
    .use(rehypeWrapTables)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['heading-anchor'] },
    })
    .use(rehypeRewriteUrls, options)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
}
