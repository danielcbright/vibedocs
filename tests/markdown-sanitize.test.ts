import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { renderSinglePage } from '../src/render.js'
import type { SafePath } from '../src/path-resolver.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Test helper: render a markdown source string through `renderSinglePage`
// (the live-mode renderer) by materialising it as a temp file. The render
// pipeline is the same as production — this is what the live `/api/render`
// route and the build CLI both use. We bypass `PathResolver` and brand the
// absolute path directly because path validation isn't what these tests
// pin; the sanitizer behaviour is.
async function renderMarkdownString(
  tmpDir: string,
  md: string,
  filename = 'doc.md',
): Promise<string> {
  const absPath = path.join(tmpDir, filename)
  await writeFile(absPath, md)
  const page = await renderSinglePage(
    absPath as SafePath,
    path.basename(tmpDir),
    filename,
    'live',
  )
  return page.html
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-sanitize-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('renderSinglePage — XSS sanitization', () => {
  it('strips inline <script> tags from raw HTML in markdown', async () => {
    const html = await renderMarkdownString(tmpDir, 'Hello\n\n<script>alert(1)</script>\n\nworld')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips onerror (and other event handlers) from inline <img> tags', async () => {
    const html = await renderMarkdownString(tmpDir, 'Look: <img src="x" onerror="alert(1)">')
    // The onerror attribute (the actual XSS vector) must NOT survive. Whether
    // the <img> itself survives is acceptable either way — what matters is
    // that the event handler is gone.
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toContain('alert(1)')
  })

  it('strips <iframe> tags from raw HTML in markdown', async () => {
    const html = await renderMarkdownString(
      tmpDir,
      'Before\n\n<iframe src="https://evil.example/x"></iframe>\n\nafter',
    )
    expect(html).not.toMatch(/<iframe/i)
    expect(html).not.toContain('evil.example')
  })

  it('strips javascript: URLs from markdown links', async () => {
    const html = await renderMarkdownString(tmpDir, '[click me](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('alert(1)')
    // The link text should still be present
    expect(html).toContain('click me')
  })

  it('preserves valid markdown features (headings, code blocks, tables, mermaid, links)', async () => {
    // This is the AC#5 round-trip check: real-world docs must still render.
    // Rather than snapshotting the entire docs/architecture.md output (which
    // would churn on unrelated content edits), assert the structural
    // invariants that the sanitizer schema must not strip.
    const archPath = join(__dirname, '..', 'docs', 'architecture.md')
    const md = await readFile(archPath, 'utf-8')
    const html = await renderMarkdownString(tmpDir, md)

    // Headings get id attributes from rehype-slug + heading-anchor wrap
    expect(html).toMatch(/<h1[^>]*id="[^"]+"/)
    expect(html).toMatch(/<a class="heading-anchor"/)
    // Mermaid wrapper survives (architecture.md has a system-diagram mermaid block)
    expect(html).toMatch(/<div class="mermaid">/)
    // Table-wrap div survives (architecture.md has GFM tables)
    expect(html).toMatch(/<div class="table-wrap">/)
    // No XSS markup somehow slipped in from the source doc
    expect(html).not.toMatch(/<script[\s>]/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it('preserves mermaid wrapper div for benign diagram source', async () => {
    const html = await renderMarkdownString(tmpDir, '```mermaid\ngraph TD\n  A --> B\n```')
    expect(html).toMatch(/<div class="mermaid">graph TD/)
  })

  it('preserves heading anchors, links, code blocks, and tables together', async () => {
    const md = [
      '# Hello',
      '',
      'A [link](https://example.com/page) and `inline code`.',
      '',
      '| col1 | col2 |',
      '| ---- | ---- |',
      '| a    | b    |',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n')
    const html = await renderMarkdownString(tmpDir, md)
    expect(html).toMatch(/<h1[^>]*id="hello"/)
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/page"/)
    expect(html).toMatch(/<code>inline code<\/code>/)
    expect(html).toMatch(/<div class="table-wrap">/)
    expect(html).toMatch(/<pre class="shiki/)
    expect(html).toMatch(/<span [^>]*style="--shiki-light/)
  })

  it('prevents script injection via mermaid block content (no </div><script> escape)', async () => {
    // The pre-fix bug: `remarkMermaid` interpolated the block body into a raw
    // HTML string `<div class="mermaid">${value}</div>`, so a block body of
    // `</div><script>alert(1)</script><div>` would break out of the wrapper
    // and inject an executable script tag.
    const payload = '</div><script>alert(1)</script><div>'
    const md = '```mermaid\n' + payload + '\n```'
    const html = await renderMarkdownString(tmpDir, md)
    // No parseable <script> tag may survive. The diagram source text may
    // still contain the literal characters s-c-r-i-p-t (HTML-encoded), but
    // a browser parsing the output must not see an actual script element.
    expect(html).not.toMatch(/<script[\s>]/i)
    expect(html).not.toMatch(/<\/script>/i)
    // The wrapper div should still be present so the client-side mermaid
    // renderer can pick the diagram up.
    expect(html).toMatch(/<div class="mermaid">/)
    // The wrapper must also close as a div, not be broken out of mid-way.
    expect(html).toMatch(/<div class="mermaid">[^<]*&#x3C;\/div>/)
  })
})
