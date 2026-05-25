import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { renderProject, renderSinglePage } from '../src/render.js'
import { renderMarkdown, extractToc } from '../src/markdown.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let tmpDir: string
let projectPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-render-test-'))
  projectPath = path.join(tmpDir, 'myproject')
  await mkdir(projectPath, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('renderProject — basic page rendering', () => {
  it('renders a single markdown doc and returns its rendered HTML', async () => {
    await writeFile(path.join(projectPath, 'README.md'), '# Hello World\n\nSome body text.')

    const result = await renderProject(projectPath, null, 'live')

    expect(result.pages.length).toBe(1)
    expect(result.pages[0].path).toBe('README.md')
    expect(result.pages[0].html).toMatch(/<h1[^>]*id="hello-world"/)
    expect(result.pages[0].html).toContain('Hello World')
  })
})

describe('renderProject — internal markdown link rewriting', () => {
  it('leaves in-project .md links unchanged in live mode (SPA hash router intercepts)', async () => {
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\nSee the [install guide](./docs/install.md).',
    )
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '# Install\n\nSteps.',
    )

    const result = await renderProject(projectPath, null, 'live')

    const readme = result.pages.find((p) => p.path === 'README.md')
    expect(readme).toBeDefined()
    // Live mode: the .md extension stays. The SPA's hash router intercepts
    // clicks and rewrites to `#myproject/docs/install.md` at runtime.
    expect(readme!.html).toMatch(/href="\.\/docs\/install\.md"/)
  })

  it('rewrites in-project .md links to clean URLs in build mode', async () => {
    // README.md has a relative link to a sibling docs/install.md. In build
    // mode that becomes a clean URL pointing at the sibling's index.html,
    // i.e. `./docs/install/`. The author wrote `.md` thinking like a
    // markdown editor; the build emits clean URLs for SEO.
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\nSee the [install guide](./docs/install.md).',
    )
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '# Install\n\nSteps.',
    )

    const result = await renderProject(projectPath, null, 'build')

    const readme = result.pages.find((p) => p.path === 'README.md')
    expect(readme).toBeDefined()
    // href becomes the clean-URL form. The `.md` extension is dropped and
    // a trailing slash is added so the browser resolves to index.html.
    expect(readme!.html).toMatch(/href="\.\/docs\/install\/"/)
    expect(readme!.html).not.toMatch(/href="[^"]*\.md"/)
  })

  it('leaves external https:// links untouched in both modes', async () => {
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n[External](https://example.com/page) and [mail](mailto:foo@bar.com).',
    )

    const liveResult = await renderProject(projectPath, null, 'live')
    const buildResult = await renderProject(projectPath, null, 'build')

    for (const result of [liveResult, buildResult]) {
      const readme = result.pages.find((p) => p.path === 'README.md')!
      expect(readme.html).toContain('href="https://example.com/page"')
      expect(readme.html).toContain('href="mailto:foo@bar.com"')
    }
  })
})

describe('renderSinglePage — live-route regression', () => {
  // The live Hono route `/api/render/:project/*` was previously implemented as
  // `renderFile(absPath)` + `extractToc(html)`. This sprint swaps it to call
  // `renderSinglePage(projectPath, docPath, 'live')`. The HTML emitted by the
  // new path must structurally match what the old pipeline emits for any doc
  // that contains zero relative links to in-project assets/markdown — i.e.
  // the full set of vibedocs's own docs today, none of which use relative
  // images. This test pins that invariant against the real architecture.md.
  it("preserves the legacy pipeline's structural output on docs/architecture.md", async () => {
    const archPath = join(__dirname, '..', 'docs', 'architecture.md')
    const md = await readFile(archPath, 'utf-8')
    const oldHtml = await renderMarkdown(md)
    const projectDir = join(__dirname, '..')
    const newPage = await renderSinglePage(projectDir, 'docs/architecture.md', 'live')

    // The full HTML strings should be byte-identical for docs with no relative
    // markdown links and no relative images — architecture.md fits both.
    // (If a future architecture.md edit adds a relative image, this test will
    // start failing; that's the right signal — split it into two assertions
    // at that point.)
    expect(newPage.html).toBe(oldHtml)

    // TOC extraction must continue to produce the same shape.
    expect(newPage.toc).toEqual(extractToc(oldHtml))
  })

  it('preserves Shiki classes, mermaid wrapper, table-wrap, and heading anchors', async () => {
    // Spec invariants from the AC: Shiki output (`<pre class="shiki">`,
    // tokens with `--shiki-light`/`--shiki-dark`), mermaid div wrapper,
    // table-wrap div, and rehype-autolink-headings `<a class="heading-anchor">`
    // must all survive the new pipeline.
    const md = [
      '# Heading One',
      '',
      'A paragraph with `code`.',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '| h1 | h2 |',
      '| -- | -- |',
      '| a  | b  |',
    ].join('\n')

    await writeFile(path.join(projectPath, 'doc.md'), md)
    const page = await renderSinglePage(projectPath, 'doc.md', 'live')

    expect(page.html).toMatch(/<h1[^>]*id="heading-one"/)
    expect(page.html).toMatch(/<a class="heading-anchor"/)
    expect(page.html).toMatch(/<pre class="shiki/)
    expect(page.html).toMatch(/<span [^>]*style="--shiki-light/)
    expect(page.html).toMatch(/<div class="mermaid">/)
    expect(page.html).toMatch(/<div class="table-wrap">/)
  })

  it('rejects XSS payloads from the renderer pipeline (no regression vs #33)', async () => {
    // The sanitizer is the security boundary. The new render.ts pipeline
    // reuses the same sanitizeSchema from markdown.ts, but this test pins
    // that fact behaviourally — if a future refactor accidentally drops
    // rehype-sanitize from the build pipeline, this test screams.
    const md = [
      '# Doc',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '[click](javascript:alert(1))',
    ].join('\n')

    await writeFile(path.join(projectPath, 'evil.md'), md)
    const page = await renderSinglePage(projectPath, 'evil.md', 'live')

    expect(page.html).not.toMatch(/<script[\s>]/i)
    expect(page.html).not.toMatch(/onerror/i)
    expect(page.html).not.toMatch(/javascript:/i)
    expect(page.html).not.toContain('alert(1)')
  })
})

describe('renderProject — site-config-derived outputs (placeholders for later slices)', () => {
  it('returns null for llmsTxt, sitemap, robots when siteConfig is null', async () => {
    await writeFile(path.join(projectPath, 'README.md'), '# Hello')

    const result = await renderProject(projectPath, null, 'live')

    expect(result.llmsTxt).toBeNull()
    expect(result.sitemap).toBeNull()
    expect(result.robots).toBeNull()
  })

  it('returns null for llmsTxt in live mode even when siteConfig is provided', async () => {
    // Live mode does not write llms.txt — the build CLI is the consumer.
    // (Slice #53 fills in the real generator behind a `mode === "build"`
    // gate; this test pins the gate.)
    await writeFile(path.join(projectPath, 'README.md'), '# Hello')

    const result = await renderProject(projectPath, {}, 'live')

    expect(result.llmsTxt).toBeNull()
  })

  it('returns a non-null llmsTxt placeholder in build mode when siteConfig is provided', async () => {
    // The real generator (slice #53) replaces this empty string with the
    // llmstxt.org-formatted index. This slice just commits to the
    // not-null shape so consumers can write `if (result.llmsTxt) write(...)`
    // without worrying about the build-mode case.
    await writeFile(path.join(projectPath, 'README.md'), '# Hello')

    const result = await renderProject(projectPath, {}, 'build')

    expect(result.llmsTxt).not.toBeNull()
    expect(typeof result.llmsTxt).toBe('string')
  })
})

describe('renderProject — whole-project walk', () => {
  it('renders every markdown file in a multi-doc project tree', async () => {
    await mkdir(path.join(projectPath, 'docs', 'sub'), { recursive: true })
    await writeFile(path.join(projectPath, 'README.md'), '# Top')
    await writeFile(path.join(projectPath, 'docs', 'a.md'), '# A')
    await writeFile(path.join(projectPath, 'docs', 'b.markdown'), '# B')
    await writeFile(path.join(projectPath, 'docs', 'sub', 'c.md'), '# C')
    // Non-markdown file — should NOT appear in pages.
    await writeFile(path.join(projectPath, 'docs', 'diagram.png'), 'fake')

    const result = await renderProject(projectPath, null, 'live')

    const pagePaths = result.pages.map((p) => p.path).sort()
    expect(pagePaths).toEqual([
      'README.md',
      'docs/a.md',
      'docs/b.markdown',
      'docs/sub/c.md',
    ])

    // Non-markdown file shows up as an asset.
    const assetPaths = result.assets.map((a) => a.sourcePath)
    expect(assetPaths).toContain('docs/diagram.png')
  })
})

describe('renderProject — image / asset URL rewriting', () => {
  it('rewrites image src to /api/file/<project>/<path> in live mode', async () => {
    // myproject/docs/install.md references `./diagram.png` (sibling).
    // Live mode: <img src="/api/file/myproject/docs/diagram.png">
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '# Install\n\n![diagram](./diagram.png)',
    )
    await writeFile(path.join(projectPath, 'docs', 'diagram.png'), 'fake')

    const result = await renderProject(projectPath, null, 'live')

    const page = result.pages.find((p) => p.path === 'docs/install.md')!
    expect(page.html).toMatch(/<img[^>]*src="\/api\/file\/myproject\/docs\/diagram\.png"/)
  })

  it('rewrites image src to relative mirrored path in build mode (subdirectory page)', async () => {
    // myproject/docs/install.md references `./diagram.png` (sibling).
    // Build mode: page URL is `/docs/install/`, asset URL is `/docs/diagram.png`,
    // so the relative href should be `../diagram.png`.
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '# Install\n\n![diagram](./diagram.png)',
    )
    await writeFile(path.join(projectPath, 'docs', 'diagram.png'), 'fake')

    const result = await renderProject(projectPath, null, 'build')

    const page = result.pages.find((p) => p.path === 'docs/install.md')!
    expect(page.html).toMatch(/<img[^>]*src="\.\.\/diagram\.png"/)
  })

  it('leaves external https:// image URLs untouched in both modes', async () => {
    // The renderer must not turn an external CDN image into `/api/file/...`
    // or a relative mirrored path — both would 404. Sanitizer-stripped URL
    // schemes (data:, javascript:) are a separate concern; this test only
    // pins the rewriter's pass-through behaviour for ordinary external https.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n![remote](https://cdn.example/logo.png)',
    )

    const liveResult = await renderProject(projectPath, null, 'live')
    const buildResult = await renderProject(projectPath, null, 'build')

    for (const result of [liveResult, buildResult]) {
      const page = result.pages.find((p) => p.path === 'README.md')!
      expect(page.html).toContain('src="https://cdn.example/logo.png"')
    }
  })
})
