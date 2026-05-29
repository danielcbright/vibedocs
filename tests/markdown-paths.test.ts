import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  MARKDOWN_EXTENSIONS,
  isMarkdownPath,
} from '../src/markdown-paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '..', 'src')

describe('markdown-paths SSOT module', () => {
  it('exports MARKDOWN_EXTENSIONS as a readonly array with the canonical entries', () => {
    expect(Array.isArray(MARKDOWN_EXTENSIONS)).toBe(true)
    // The canonical extension list — render, discovery, search, server,
    // url-rewriter, and path-resolver all share this.
    const expected = ['.md', '.markdown']
    expect([...MARKDOWN_EXTENSIONS].sort()).toEqual([...expected].sort())
  })

  it('isMarkdownPath returns true for every canonical extension', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/install.markdown')).toBe(true)
  })

  it('isMarkdownPath is case-insensitive', () => {
    expect(isMarkdownPath('README.MD')).toBe(true)
    expect(isMarkdownPath('docs/Install.Markdown')).toBe(true)
  })

  it('isMarkdownPath returns false for non-markdown extensions', () => {
    expect(isMarkdownPath('image.png')).toBe(false)
    expect(isMarkdownPath('script.js')).toBe(false)
    expect(isMarkdownPath('README')).toBe(false)
    expect(isMarkdownPath('')).toBe(false)
  })

  it('isMarkdownPath rejects extension-like substrings that are not suffixes', () => {
    // `.md` in the middle of a name must not match — the legacy
    // `endsWith('.md')` calls had this property, preserve it.
    expect(isMarkdownPath('archived.md.bak')).toBe(false)
    expect(isMarkdownPath('foo.markdownish')).toBe(false)
  })
})

describe('no consumer redefines isMarkdown locally', () => {
  // The five layers (render, discovery, search, server, url-rewriter) must
  // import the predicate from src/markdown-paths.ts. Re-defining a local
  // `isMarkdown` or inlining `endsWith('.md')` silently desynchronises the
  // layers — the exact coupling bug #83 fixes.
  const consumerFiles = [
    'render.ts',
    'discovery.ts',
    'search.ts',
    'server.ts',
    'url-rewriter.ts',
  ]

  for (const file of consumerFiles) {
    it(`src/${file} does not declare a local 'isMarkdown' function`, async () => {
      const source = await readFile(path.join(srcDir, file), 'utf-8')
      // Heuristic: any line that declares isMarkdown as a function is a
      // redefinition. Only the SSOT module declares `isMarkdownPath`.
      const localDefRe = /function\s+isMarkdown\s*\(/
      expect(source).not.toMatch(localDefRe)
    })

    it(`src/${file} does not inline endsWith('.md') / endsWith('.markdown') checks`, async () => {
      const source = await readFile(path.join(srcDir, file), 'utf-8')
      // The legacy duplications were `entry.endsWith('.md')` / `name.endsWith('.markdown')`.
      // Any remaining instance means a caller bypasses the SSOT.
      const inlineRe = /\.endsWith\(\s*['"]\.markdown['"]\s*\)/
      expect(source).not.toMatch(inlineRe)
    })

    it(`src/${file} imports from the SSOT module`, async () => {
      const source = await readFile(path.join(srcDir, file), 'utf-8')
      expect(source).toMatch(/from\s+['"]\.\/markdown-paths\.js['"]/)
    })
  }
})
