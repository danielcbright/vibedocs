import { describe, it, expect } from 'vitest'
import { createMarkdownProcessor } from '../src/markdown-processor.js'

// Dedicated security-perimeter test file for the sanitize schema
// (`sanitizeSchema` in `src/markdown-plugins.ts`). Drives the markdown
// processor factory directly — no `renderProject`, no HTTP, no temp files.
//
// Each test asserts that a specific dangerous pattern is rejected by the
// sanitizer step, and that benign markdown features still pass through.
// Issue #89, follow-up to #85 (Markdown processor factory).
//
// If any test FAILS, the perimeter has a real gap. Per the issue's
// acceptance criteria, the right response is to tighten `sanitizeSchema`
// in `src/markdown-plugins.ts` and add an inline comment explaining the
// gap that the regression test now guards against.

function makeProcessor() {
  return createMarkdownProcessor({
    mode: 'live',
    projectName: 'security-test',
    currentDocPath: 'doc.md',
  })
}

async function render(md: string): Promise<string> {
  const result = await makeProcessor().process(md)
  return String(result)
}

describe('sanitizeSchema — dangerous element rejection', () => {
  it('rejects raw <script> elements', async () => {
    const html = await render('Before\n\n<script>alert("xss")</script>\n\nAfter')
    expect(html).not.toMatch(/<script[\s>]/i)
    expect(html).not.toMatch(/<\/script>/i)
    expect(html).not.toContain('alert("xss")')
  })

  it('rejects raw <iframe> elements', async () => {
    const html = await render(
      'Before\n\n<iframe src="https://evil.example/x"></iframe>\n\nAfter',
    )
    expect(html).not.toMatch(/<iframe[\s>]/i)
    expect(html).not.toMatch(/<\/iframe>/i)
    expect(html).not.toContain('evil.example')
  })

  it('rejects raw <object> elements', async () => {
    const html = await render(
      'Before\n\n<object data="https://evil.example/x.swf"></object>\n\nAfter',
    )
    expect(html).not.toMatch(/<object[\s>]/i)
    expect(html).not.toMatch(/<\/object>/i)
    expect(html).not.toContain('evil.example')
  })

  it('rejects raw <embed> elements', async () => {
    const html = await render(
      'Before\n\n<embed src="https://evil.example/x.swf" type="application/x-shockwave-flash">\n\nAfter',
    )
    expect(html).not.toMatch(/<embed[\s>]/i)
    expect(html).not.toContain('evil.example')
  })
})

describe('sanitizeSchema — dangerous attribute rejection', () => {
  it('strips event handler attributes (onclick, onerror, onmouseover, onload, onfocus) from inline HTML', async () => {
    // Each handler is a known XSS vector. None must survive sanitisation.
    const md = [
      '<img src="x" onerror="alert(1)">',
      '',
      '<a href="https://example.com" onclick="alert(2)">link</a>',
      '',
      '<span onmouseover="alert(3)">hover</span>',
      '',
      '<img src="y" onload="alert(4)">',
      '',
      '<input onfocus="alert(5)">',
    ].join('\n')
    const html = await render(md)
    expect(html).not.toMatch(/\bon[a-z]+\s*=/i)
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('alert(2)')
    expect(html).not.toContain('alert(3)')
    expect(html).not.toContain('alert(4)')
    expect(html).not.toContain('alert(5)')
  })
})

describe('sanitizeSchema — dangerous URL rejection', () => {
  it('strips javascript: URLs from markdown links', async () => {
    const html = await render('[click me](javascript:alert(1))')
    expect(html).not.toMatch(/href="javascript:/i)
    expect(html).not.toContain('alert(1)')
    // Link text should still render
    expect(html).toContain('click me')
  })

  it('strips dangerous data: URLs from both <a href> and <img src>', async () => {
    // data:text/html can execute script in some browser contexts. The default
    // rehype-sanitize schema does not allow the `data:` protocol on <a href>
    // (allowed protocols are http, https, mailto, etc.), so the href must
    // be stripped.
    const dangerousLink = await render(
      '[evil](data:text/html,<script>alert(1)</script>)',
    )
    expect(dangerousLink).not.toMatch(/href="data:/i)
    expect(dangerousLink).not.toContain('<script')
    expect(dangerousLink).not.toContain('alert(1)')

    // The default schema is conservative on <img src> too — it does not
    // allow ANY `data:` URL (not even image/png). This is a stricter
    // posture than strictly necessary, but a safe one: legitimate inline
    // images are uncommon in our docs and the perimeter favours rejection
    // over a MIME-sniffing allowlist. Pin the current behaviour so a
    // future loosening is a conscious choice.
    const dangerousImg = await render(
      '![evil](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    )
    expect(dangerousImg).not.toMatch(/src="data:/i)

    const pngImg = await render(
      '![pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)',
    )
    expect(pngImg).not.toMatch(/src="data:/i)
  })
})

describe('sanitizeSchema — SVG perimeter', () => {
  it('rejects <script> elements nested inside <svg> (and strips <svg> itself)', async () => {
    // SVG is a known XSS vector because <script> inside SVG executes when
    // the SVG is rendered inline. The default rehype-sanitize schema does
    // not allow <svg> at all (it's not in the default tagNames allowlist),
    // so the wrapper is stripped. The nested <script> element must ALSO
    // be stripped — what's left should not be parseable as a script tag.
    //
    // Note: stripping a <script> wrapper turns its text content into plain
    // text in the parent, so the literal characters `alert(...)` may still
    // appear in the output as visible text. That's not an XSS — a browser
    // parses it as a text node, not as code. The vulnerability would be
    // an actual `<script>` element surviving, which we assert against.
    const html = await render(
      'Before\n\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert("svg-xss")</script></svg>\n\nAfter',
    )
    expect(html).not.toMatch(/<script[\s>]/i)
    expect(html).not.toMatch(/<\/script>/i)
    expect(html).not.toMatch(/<svg[\s>]/i)
  })
})

describe('sanitizeSchema — benign markdown features still pass through', () => {
  it('preserves headings, links, images, code blocks, tables, and lists in a normal doc', async () => {
    const md = [
      '# Heading 1',
      '',
      '## Heading 2',
      '',
      'A [link](https://example.com/page) and `inline code`.',
      '',
      '![alt text](https://example.com/img.png)',
      '',
      '- list item one',
      '- list item two',
      '',
      '1. ordered item one',
      '2. ordered item two',
      '',
      '| col1 | col2 |',
      '| ---- | ---- |',
      '| a    | b    |',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n')
    const html = await render(md)

    // Headings with anchor ids (rehype-slug + heading-anchor wrap)
    expect(html).toMatch(/<h1[^>]*id="heading-1"/)
    expect(html).toMatch(/<h2[^>]*id="heading-2"/)

    // External link survives
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/page"/)

    // Image survives (external src, alt preserved)
    expect(html).toMatch(/<img [^>]*src="https:\/\/example\.com\/img\.png"/)
    expect(html).toMatch(/alt="alt text"/)

    // Inline code survives
    expect(html).toMatch(/<code>inline code<\/code>/)

    // Lists survive
    expect(html).toMatch(/<ul>[\s\S]*<li>list item one<\/li>/)
    expect(html).toMatch(/<ol>[\s\S]*<li>ordered item one<\/li>/)

    // Table-wrap div survives (rehype-wrap-tables)
    expect(html).toMatch(/<div class="table-wrap">/)
    expect(html).toMatch(/<table>/)

    // Shiki-highlighted code block survives with className intact
    expect(html).toMatch(/<pre[^>]*class="[^"]*shiki/)
  })
})
