import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../src/markdown.js'

describe('renderMarkdown — horizontal-scroll wrappers', () => {
  it('wraps GFM tables in <div class="table-wrap"> so they can scroll horizontally on narrow viewports', async () => {
    const md = [
      '| h1 | h2 | h3 |',
      '| -- | -- | -- |',
      '| a  | b  | c  |',
    ].join('\n')

    const html = await renderMarkdown(md)

    // The table itself must still be emitted...
    expect(html).toMatch(/<table[\s>]/)
    // ...but it must be inside a div with the wrap class so the CSS
    // overflow-scroll affordance can attach to a real scroll container.
    expect(html).toMatch(/<div class="table-wrap">[\s\S]*<table[\s>][\s\S]*<\/table>[\s\S]*<\/div>/)
  })

  it('does not wrap content other than tables', async () => {
    const md = 'Just a paragraph with `inline code` and **bold**.'
    const html = await renderMarkdown(md)
    expect(html).not.toContain('table-wrap')
  })
})
