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
