import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'
import rehypeShiki from '@shikijs/rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Schema } from 'hast-util-sanitize'
import { readFile } from 'fs/promises'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'

interface CodeNode extends Node {
  type: 'code'
  lang?: string
  value: string
}

interface TextNode extends Node {
  type: 'text'
  value: string
}

// hast (rehype) element shape — we only touch the bits we need.
interface HastElement extends Node {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: Array<HastElement | TextNode>
}

// Remark plugin: transform ```mermaid blocks into a `<div class="mermaid">`
// containing the diagram source as a TEXT node (not raw HTML).
//
// The previous implementation interpolated the block body into a raw-HTML
// string `<div class="mermaid">${value}</div>`. That string was emitted
// through `remarkRehype({ allowDangerousHtml: true })` and reached the DOM
// untouched, so a block body of `</div><script>alert(1)</script><div>` would
// escape the wrapper and inject an executable script tag.
//
// The fix: use mdast-util-to-hast's `data.hName` / `hProperties` / `hChildren`
// override to swap the mdast `code` node for a hast element node directly.
// The diagram source becomes a hast `text` node, which the sanitizer treats
// as plain text and the stringifier HTML-encodes (`<` → `&#x3C;` etc). The
// client-side mermaid renderer reads `textContent`, which decodes the entity
// references back to the original characters — so the diagram still renders.
export function remarkMermaid() {
  return (tree: Node) => {
    visit(tree, 'code', (node: CodeNode, index, parent: any) => {
      if (node.lang !== 'mermaid') return
      if (!parent || index === undefined || index === null) return
      const replacement: Node & { data: unknown } = {
        type: 'mermaidBlock',
        data: {
          hName: 'div',
          hProperties: { className: ['mermaid'] },
          hChildren: [{ type: 'text', value: node.value }],
        },
      }
      parent.children.splice(index, 1, replacement)
    })
  }
}

// Rehype plugin: wrap each <table> in <div class="table-wrap"> so the CSS
// horizontal-scroll affordance has a real scroll container to attach to on
// narrow viewports. See frontend/src/index.css `.table-wrap` rules.
export function rehypeWrapTables() {
  return (tree: Node) => {
    visit(tree, 'element', (node: HastElement, index, parent: any) => {
      if (node.tagName !== 'table') return
      if (!parent || index === undefined || index === null) return
      // Don't double-wrap if a previous pass already added the wrapper.
      if (parent.type === 'element' && parent.tagName === 'div'
        && Array.isArray((parent as HastElement).properties?.className)
        && ((parent as HastElement).properties!.className as string[]).includes('table-wrap')) {
        return
      }
      const wrapper: HastElement = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-wrap'] },
        children: [node],
      }
      parent.children.splice(index, 1, wrapper)
    })
  }
}

// Sanitizer schema. Extends rehype-sanitize's default (which blocks
// `<script>`, `<iframe>`, `<object>`, event-handler attributes like onerror,
// `javascript:` URLs, etc.) with the extra freedoms our pipeline needs:
//
//   - `className` / `class` allowed on any element. The pipeline needs this
//     for Shiki tokens, the table-wrap div, the mermaid div, and the
//     heading-anchor link.
//   - `style` allowed on `pre`, `code`, `span` — these are where Shiki emits
//     its per-token CSS variables (`--shiki-light` / `--shiki-dark`).
//   - `tabIndex` allowed on `pre` — Shiki adds it for keyboard scrolling.
//
// Why both `class` AND `className`, and both `tabindex` AND `tabIndex`:
// `@shikijs/rehype` emits non-canonical hast property names (`class` instead
// of the canonical `className`, `tabindex` instead of `tabIndex`). Allowing
// both spellings is simpler than running a normalisation pass and the values
// still go through hast-util-sanitize's per-attribute value scrubbing.
//
// Why we OVERRIDE certain tag entries (`a`, `code`, `h2`, `pre`, `span`)
// rather than append: the default schema restricts `className` on those tags
// to specific values (e.g. `"sr-only"`, `"data-footnote-backref"`), which
// would strip the class hooks the highlighter and heading-link plugins need.
//
// Why `clobberPrefix: ''` and `clobber: []`: the default schema rewrites
// every `id` to `user-content-…` to prevent DOM-clobbering attacks against
// an outer document. We render into a sandboxed React-controlled root, so
// the prefix only breaks our `href="#slug"` autolink-heading targets.
//
// Anything not listed here is stripped. The schema is the security boundary;
// do not loosen it without reviewing what new vectors that opens.
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  // Disable id-clobbering so heading anchors keep their natural ids and the
  // `href="#slug"` autolinks resolve correctly. The default schema prefixes
  // every id with `user-content-` to prevent DOM-clobbering attacks against
  // an outer document; we're rendering into a sandboxed React-controlled
  // root so the prefix is unnecessary friction.
  clobberPrefix: '',
  clobber: [],
  attributes: {
    ...defaultSchema.attributes,
    // Global wildcard: anything goes through these on every element.
    // `className` / `class` are the big additions; the rest mirror the
    // default wildcard.
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className',
      'class',
    ],
    // Override tag-specific entries that would otherwise restrict className
    // to specific values. We preserve the original allowed attribute NAMES
    // (e.g. `href` on `<a>`) but drop the value-tuple restrictions.
    a: ['ariaDescribedBy', 'ariaLabel', 'ariaLabelledBy', 'href'],
    code: [],
    h2: [],
    // Shiki output: <pre class="shiki ..." style="--shiki-light:..." tabindex="0">
    pre: ['style', 'tabIndex', 'tabindex'],
    // Shiki tokens: <span class="line"> and <span style="--shiki-light:#...">
    span: ['style'],
  },
}

// Build the processor once (shiki init is async, handled via rehypeShiki)
async function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaid)
    // No `allowDangerousHtml`: raw HTML in markdown is parsed as text and
    // will be escaped (or, if we ever opted back in, would need a follow-up
    // `rehype-raw` pass — we don't, on purpose).
    .use(remarkRehype)
    .use(rehypeShiki, {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      // Don't error on unknown languages — fall back to plain text
      fallbackLanguage: 'text',
    })
    .use(rehypeWrapTables)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['heading-anchor'] },
    })
    // Sanitize AFTER all rehype transforms so Shiki's spans, our table
    // wrappers, mermaid divs, and autolink-heading anchors are visible to
    // the schema. Running it earlier would let later plugins re-introduce
    // unsafe markup; running it last is the security boundary.
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
}

let processorPromise: ReturnType<typeof buildProcessor> | null = null

function getProcessor() {
  if (!processorPromise) {
    processorPromise = buildProcessor()
  }
  return processorPromise
}

export async function renderMarkdown(content: string): Promise<string> {
  const processor = await getProcessor()
  const result = await processor.process(content)
  return String(result)
}

export async function renderFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8')
  return renderMarkdown(content)
}

// Extract headings for table of contents
export function extractToc(html: string): Array<{ level: number; id: string; text: string }> {
  const toc: Array<{ level: number; id: string; text: string }> = []
  const headingRe = /<h([1-3])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h[1-3]>/gi
  let match: RegExpExecArray | null

  while ((match = headingRe.exec(html)) !== null) {
    const level = parseInt(match[1])
    const id = match[2]
    // Strip inner HTML tags to get plain text
    const text = match[3].replace(/<[^>]+>/g, '').trim()
    toc.push({ level, id, text })
  }

  return toc
}
