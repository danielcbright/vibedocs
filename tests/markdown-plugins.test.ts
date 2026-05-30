import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import {
  remarkMermaid,
  rehypeWrapTables,
  extractToc,
} from '../src/markdown-plugins.js'

/**
 * Direct plugin contract tests. These pin behaviour at the seam — the full
 * markdown-processor.test.ts exercises the whole pipeline; here we assert
 * each plugin's own contract so a regression in (eg) the mermaid hast-data
 * swap surfaces in a plugin test rather than as a confusing whole-pipeline
 * diff. Seam 3 from arch-audit round 2.
 */

// Minimal pipeline that just runs remark→rehype→stringify with the plugin
// under test slotted in. No Shiki, no sanitize, no autolink — keeps assertions
// readable.
function makeRemarkPipeline() {
  return unified()
    .use(remarkParse)
    .use(remarkMermaid)
    .use(remarkRehype as any, { allowDangerousHtml: false })
    .use(rehypeStringify)
}

function makeRehypePipeline() {
  return unified()
    .use(remarkParse)
    .use(remarkRehype as any)
    .use(rehypeWrapTables)
    .use(rehypeStringify)
}

describe('remarkMermaid', () => {
  it('converts a fenced ```mermaid block into <div class="mermaid"> with text content', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```\n'
    const html = String(await makeRemarkPipeline().process(md))

    expect(html).toContain('<div class="mermaid">')
    // The diagram source is a text node — present verbatim (HTML stringifier
    // only entity-escapes `<`, `&`, and a few control chars in text content;
    // `>` is left alone).
    expect(html).toContain('graph TD')
    expect(html).toContain('A-->B')
    // No raw <code><pre> wrapping for the mermaid block.
    expect(html).not.toMatch(/<pre><code[^>]*class="[^"]*language-mermaid/)
  })

  it('leaves non-mermaid code blocks untouched', async () => {
    const md = '```ts\nconst x = 1\n```\n'
    const html = String(await makeRemarkPipeline().process(md))

    expect(html).not.toContain('class="mermaid"')
    // Should still be a <pre><code> code block.
    expect(html).toMatch(/<pre><code[^>]*>/)
    expect(html).toContain('const x = 1')
  })

  it('does not inject raw HTML — a malicious diagram body cannot escape the wrapper', async () => {
    const md = '```mermaid\n</div><script>alert(1)</script><div>\n```\n'
    const html = String(await makeRemarkPipeline().process(md))

    // The escape attempt is HTML-encoded as text content; no executable
    // <script> tag is emitted. (The stringifier only entity-escapes `<`,
    // not `>`, so the `<script>` opener becomes `&#x3C;script>` which is
    // still inert because the leading `<` is escaped.)
    expect(html).not.toMatch(/<script[^>]*>alert/)
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>')
  })
})

describe('rehypeWrapTables', () => {
  it('wraps a <table> in <div class="table-wrap">', async () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const remarkGfm = (await import('remark-gfm')).default
    const html = String(
      await unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype as any)
        .use(rehypeWrapTables)
        .use(rehypeStringify)
        .process(md),
    )

    expect(html).toMatch(/<div class="table-wrap"><table>/)
    expect(html).toMatch(/<\/table><\/div>/)
  })

  it('leaves non-table elements alone (no wrapper added to paragraphs)', async () => {
    const md = 'just a paragraph\n'
    const html = String(await makeRehypePipeline().process(md))

    expect(html).not.toContain('table-wrap')
    expect(html).toContain('<p>just a paragraph</p>')
  })

  it('does not double-wrap when the table is already inside a table-wrap div (idempotent on a previous pass)', async () => {
    // Drive the plugin directly on a hast tree that already has the wrapper,
    // confirming the guard in `rehypeWrapTables` doesn't add a second one.
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-wrap'] },
          children: [
            { type: 'element', tagName: 'table', properties: {}, children: [] },
          ],
        },
      ],
    } as any
    const transform = rehypeWrapTables()
    transform(tree)
    // Still only one .table-wrap > table.
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].tagName).toBe('div')
    expect(tree.children[0].children).toHaveLength(1)
    expect(tree.children[0].children[0].tagName).toBe('table')
  })
})

describe('extractToc', () => {
  it('extracts h1/h2/h3 entries with id, text, and depth level', () => {
    const html = [
      '<h1 id="intro">Intro</h1>',
      '<p>some prose</p>',
      '<h2 id="install">Install</h2>',
      '<h3 id="install-npm">via npm</h3>',
    ].join('')

    const toc = extractToc(html)
    expect(toc).toEqual([
      { level: 1, id: 'intro', text: 'Intro' },
      { level: 2, id: 'install', text: 'Install' },
      { level: 3, id: 'install-npm', text: 'via npm' },
    ])
  })

  it('returns an empty array for HTML with no h1/h2/h3 headings', () => {
    expect(extractToc('')).toEqual([])
    expect(extractToc('<p>nothing here</p>')).toEqual([])
    expect(extractToc('<h4 id="x">deeper</h4>')).toEqual([])
  })

  it('ignores headings that lack an id attribute', () => {
    const html = '<h1>no id</h1><h2 id="with-id">with id</h2>'
    const toc = extractToc(html)
    expect(toc).toEqual([{ level: 2, id: 'with-id', text: 'with id' }])
  })

  it('strips inline tags from heading text (autolink-headings wraps in <a>)', () => {
    const html = '<h2 id="sec"><a href="#sec" class="heading-anchor">Section <span>One</span></a></h2>'
    expect(extractToc(html)).toEqual([
      { level: 2, id: 'sec', text: 'Section One' },
    ])
  })
})
