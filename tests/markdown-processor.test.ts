import { describe, it, expect } from 'vitest'
import { createMarkdownProcessor } from '../src/markdown-processor.js'

// These tests exercise the processor factory directly, without going through
// renderProject / renderSinglePage. The factory is the testable seam for
// pipeline behaviour: plugin ordering, mode-aware URL rewriting, sanitize
// schema. Issue #85.

describe('createMarkdownProcessor — basic pipeline', () => {
  it('produces a processor that renders markdown headings to HTML with anchor ids', async () => {
    const processor = createMarkdownProcessor({
      mode: 'live',
      projectName: 'p',
      currentDocPath: 'doc.md',
    })
    const result = await processor.process('# Hello World\n\nbody')
    const html = String(result)
    expect(html).toMatch(/<h1[^>]*id="hello-world"/)
    expect(html).toContain('Hello World')
  })
})

describe('createMarkdownProcessor — honors mode in URL rewriter', () => {
  it('leaves in-project .md links unchanged in live mode (SPA hash router intercepts)', async () => {
    const processor = createMarkdownProcessor({
      mode: 'live',
      projectName: 'myproject',
      currentDocPath: 'README.md',
    })
    const result = await processor.process(
      'See the [install guide](./docs/install.md).',
    )
    const html = String(result)
    // Live mode: the .md extension stays.
    expect(html).toMatch(/href="\.\/docs\/install\.md"/)
  })

  it('rewrites in-project .md links to clean URLs in build mode', async () => {
    const processor = createMarkdownProcessor({
      mode: 'build',
      projectName: 'myproject',
      currentDocPath: 'README.md',
    })
    const result = await processor.process(
      'See the [install guide](./docs/install.md).',
    )
    const html = String(result)
    // Build mode: clean URL, no .md extension.
    expect(html).toMatch(/href="\.\/docs\/install\/"/)
    expect(html).not.toMatch(/install\.md/)
  })
})
