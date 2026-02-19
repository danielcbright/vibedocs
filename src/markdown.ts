import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'
import rehypeShiki from '@shikijs/rehype'
import { readFile } from 'fs/promises'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'

interface CodeNode extends Node {
  type: 'code'
  lang?: string
  value: string
}

interface HtmlNode extends Node {
  type: 'html'
  value: string
}

// Remark plugin: transform ```mermaid blocks into passthrough <div class="mermaid">
function remarkMermaid() {
  return (tree: Node) => {
    visit(tree, 'code', (node: CodeNode, index, parent: any) => {
      if (node.lang !== 'mermaid') return
      const htmlNode: HtmlNode = {
        type: 'html',
        value: `<div class="mermaid">${node.value}</div>`,
      }
      if (parent && index !== undefined && index !== null) {
        parent.children.splice(index, 1, htmlNode)
      }
    })
  }
}

// Build the processor once (shiki init is async, handled via rehypeShiki)
async function buildProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaid)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeShiki, {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      // Don't error on unknown languages — fall back to plain text
      fallbackLanguage: 'text',
    })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['heading-anchor'] },
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
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
