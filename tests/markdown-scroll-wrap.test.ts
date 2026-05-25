import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { renderSinglePage } from '../src/render.js'
import type { SafePath } from '../src/path-resolver.js'

// Same helper shape as `markdown-sanitize.test.ts` — render a markdown string
// through the production renderer by way of a temp file.
async function renderMarkdownString(tmpDir: string, md: string): Promise<string> {
  const absPath = path.join(tmpDir, 'doc.md')
  await writeFile(absPath, md)
  const page = await renderSinglePage(
    absPath as SafePath,
    path.basename(tmpDir),
    'doc.md',
    'live',
  )
  return page.html
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-scrollwrap-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('renderSinglePage — horizontal-scroll wrappers', () => {
  it('wraps GFM tables in <div class="table-wrap"> so they can scroll horizontally on narrow viewports', async () => {
    const md = [
      '| h1 | h2 | h3 |',
      '| -- | -- | -- |',
      '| a  | b  | c  |',
    ].join('\n')

    const html = await renderMarkdownString(tmpDir, md)

    // The table itself must still be emitted...
    expect(html).toMatch(/<table[\s>]/)
    // ...but it must be inside a div with the wrap class so the CSS
    // overflow-scroll affordance can attach to a real scroll container.
    expect(html).toMatch(/<div class="table-wrap">[\s\S]*<table[\s>][\s\S]*<\/table>[\s\S]*<\/div>/)
  })

  it('does not wrap content other than tables', async () => {
    const html = await renderMarkdownString(tmpDir, 'Just a paragraph with `inline code` and **bold**.')
    expect(html).not.toContain('table-wrap')
  })
})
