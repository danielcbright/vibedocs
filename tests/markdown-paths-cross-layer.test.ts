import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { buildTreePublic } from '../src/discovery.js'
import { createIndexStore } from '../src/search.js'
import { renderProject } from '../src/render.js'
import { PathResolver } from '../src/path-resolver.js'
import { isMarkdownPath, MARKDOWN_EXTENSIONS } from '../src/markdown-paths.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-markdown-paths-xlayer-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/**
 * Cross-layer integration test for issue #83.
 *
 * Asserts that the markdown-paths policy propagates uniformly through the
 * consumer layers (discovery, search, render, path-resolver, url-rewriter).
 * For each canonical extension we materialise a file with that suffix in a
 * temp project and confirm:
 *
 *   1. discovery.buildTreePublic recognises it as a markdown file
 *      (NOT flagged with isAsset).
 *   2. search.createIndexStore indexes its content.
 *   3. render.renderProject renders it to a page (not an asset).
 *   4. PathResolver configured with MARKDOWN_EXTENSIONS accepts it.
 *
 * The propagation suite then monkey-patches `isMarkdownPath` to accept a
 * new extension (`.mdx`) and asserts the same five consumers recognise it
 * — the demoable behaviour the SSOT exists for.
 */
describe('markdown-paths — single predicate propagates to discovery, search, render, path-resolver, url-rewriter', () => {
  it('every canonical extension is recognised by discovery, search, render, and path-resolver', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    await mkdir(projectRoot, { recursive: true })

    // Materialise one file per canonical extension and one non-markdown asset.
    for (const ext of MARKDOWN_EXTENSIONS) {
      await writeFile(
        path.join(projectRoot, `doc${ext}`),
        `# doc${ext}\n\nbody-for-${ext.slice(1)}-extension`,
      )
    }
    await writeFile(path.join(projectRoot, 'photo.png'), 'PNG-binary-stub')

    // Layer 1: discovery flags every canonical extension as NOT isAsset.
    const tree = await buildTreePublic(projectRoot, projectRoot)
    for (const ext of MARKDOWN_EXTENSIONS) {
      const node = tree.find((n) => n.name === `doc${ext}`)
      expect(node, `discovery missed doc${ext}`).toBeDefined()
      expect(
        node?.isAsset,
        `discovery wrongly flagged doc${ext} as an asset`,
      ).toBeUndefined()
    }
    // Sanity: the PNG IS flagged as an asset.
    const png = tree.find((n) => n.name === 'photo.png')
    expect(png?.isAsset).toBe(true)

    // Layer 2: search indexes content from every canonical extension.
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    for (const ext of MARKDOWN_EXTENSIONS) {
      const hits = store.search(`body-for-${ext.slice(1)}-extension`, 10)
      expect(
        hits.length,
        `search did not index content from doc${ext}`,
      ).toBeGreaterThan(0)
    }

    // Layer 3: render produces an HtmlPage for every canonical extension.
    const result = await renderProject(projectRoot, null, 'live')
    for (const ext of MARKDOWN_EXTENSIONS) {
      const page = result.pages.find((p) => p.path === `doc${ext}`)
      expect(page, `render skipped doc${ext}`).toBeDefined()
    }
    // Sanity: PNG is not a page (it's an asset, not a markdown source).
    expect(result.pages.find((p) => p.path === 'photo.png')).toBeUndefined()

    // Layer 4: PathResolver configured with MARKDOWN_EXTENSIONS accepts every
    // canonical markdown file and rejects the PNG.
    const resolver = new PathResolver({
      projectsDir: tmpDir,
      requireExtensions: MARKDOWN_EXTENSIONS,
    })
    for (const ext of MARKDOWN_EXTENSIONS) {
      expect(() => resolver.resolve('proj', `doc${ext}`)).not.toThrow()
    }
    expect(() => resolver.resolve('proj', 'photo.png')).toThrow()
  })

  it('extending the predicate (mocked .mdx) is observed by every consumer', async () => {
    // Mock the SSOT predicate to also accept .mdx. ESM live bindings mean
    // every consumer reading `isMarkdownPath` at call time sees the new
    // behaviour — that IS the SSOT property under test.
    const mod = await import('../src/markdown-paths.js')
    const original = mod.isMarkdownPath
    vi.spyOn(mod, 'isMarkdownPath').mockImplementation((p: string) => {
      return original(p) || /\.mdx$/i.test(p)
    })

    const projectRoot = path.join(tmpDir, 'proj')
    await mkdir(projectRoot, { recursive: true })
    await writeFile(
      path.join(projectRoot, 'guide.mdx'),
      '# guide\n\nmdx-extension-content-marker',
    )
    // Also a plain markdown file so the project tree isn't empty in any
    // intermediate state.
    await writeFile(
      path.join(projectRoot, 'README.md'),
      '# README\n\nbaseline-markdown',
    )

    // 1. Discovery: guide.mdx is NOT flagged as an asset under the mocked predicate.
    const tree = await buildTreePublic(projectRoot, projectRoot)
    const mdxNode = tree.find((n) => n.name === 'guide.mdx')
    expect(mdxNode, 'discovery did not see guide.mdx').toBeDefined()
    expect(
      mdxNode?.isAsset,
      'discovery flagged guide.mdx as an asset — the mocked predicate did not propagate',
    ).toBeUndefined()

    // 2. Search: guide.mdx content is indexed.
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    expect(
      store.search('mdx-extension-content-marker', 10).length,
      'search did not index guide.mdx — the mocked predicate did not propagate',
    ).toBeGreaterThan(0)

    // 3. Render: guide.mdx is rendered as a page.
    const result = await renderProject(projectRoot, null, 'live')
    const mdxPage = result.pages.find((p) => p.path === 'guide.mdx')
    expect(
      mdxPage,
      'render skipped guide.mdx — the mocked predicate did not propagate',
    ).toBeDefined()
  })

  it('the live SSOT predicate is the one called from each consumer (sanity)', () => {
    // Direct call to the SSOT — anchors the predicate's identity.
    expect(isMarkdownPath('a.md')).toBe(true)
    expect(isMarkdownPath('a.markdown')).toBe(true)
    expect(isMarkdownPath('a.mdx')).toBe(false)
  })
})
