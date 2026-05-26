import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { renderProject, renderSinglePage } from '../src/render.js'
import type { SafePath } from '../src/path-resolver.js'
import type { SiteConfig } from '../src/site-config.js'

// Minimum-viable SiteConfig for tests that need a non-null config but don't
// care about its contents (e.g. the llms.txt gate). Keep it valid against
// the canonical shape so a SiteConfig refactor surfaces here too.
const MINIMAL_SITE_CONFIG: SiteConfig = {
  name: 'test',
  domain: 'example.com',
  description: 'test',
  theme: { tokens: {} },
  llms: { summary: 'test', keyDocs: [] },
}

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
  // `renderSinglePage(safePath, project, docPath, 'live')`. The byte-identical
  // pin against the legacy `renderMarkdown` was dropped when the legacy
  // module was deleted (it had no production consumer). The structural
  // invariants below cover what that pin was protecting: Shiki classes,
  // mermaid wrapper, table-wrap, heading anchors, and the sanitizer.
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

    const absPath = path.join(projectPath, 'doc.md')
    await writeFile(absPath, md)
    const page = await renderSinglePage(
      absPath as SafePath,
      'myproject',
      'doc.md',
      'live',
    )

    expect(page.html).toMatch(/<h1[^>]*id="heading-one"/)
    expect(page.html).toMatch(/<a class="heading-anchor"/)
    expect(page.html).toMatch(/<pre class="shiki/)
    expect(page.html).toMatch(/<span [^>]*style="--shiki-light/)
    expect(page.html).toMatch(/<div class="mermaid">/)
    expect(page.html).toMatch(/<div class="table-wrap">/)
  })

  it('rejects XSS payloads from the renderer pipeline (no regression vs #33)', async () => {
    // The sanitizer is the security boundary. The render.ts pipeline reuses
    // the sanitizeSchema from src/markdown-plugins.ts, but this test pins
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

    const absPath = path.join(projectPath, 'evil.md')
    await writeFile(absPath, md)
    const page = await renderSinglePage(
      absPath as SafePath,
      'myproject',
      'evil.md',
      'live',
    )

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

    const result = await renderProject(projectPath, MINIMAL_SITE_CONFIG, 'live')

    expect(result.llmsTxt).toBeNull()
  })

  it('returns a non-null llmsTxt placeholder in build mode when siteConfig is provided', async () => {
    // The real generator (slice #53) replaces this empty string with the
    // llmstxt.org-formatted index. This slice just commits to the
    // not-null shape so consumers can write `if (result.llmsTxt) write(...)`
    // without worrying about the build-mode case.
    await writeFile(path.join(projectPath, 'README.md'), '# Hello')

    const result = await renderProject(projectPath, MINIMAL_SITE_CONFIG, 'build')

    expect(result.llmsTxt).not.toBeNull()
    expect(typeof result.llmsTxt).toBe('string')
  })
})

describe('renderProject — whole-project walk', () => {
  it('renders every markdown file in a multi-doc project tree', async () => {
    await mkdir(path.join(projectPath, 'docs', 'sub'), { recursive: true })
    // docs/a.md references diagram.png so it appears in result.assets.
    await writeFile(path.join(projectPath, 'README.md'), '# Top')
    await writeFile(
      path.join(projectPath, 'docs', 'a.md'),
      '# A\n\n![diagram](./diagram.png)',
    )
    await writeFile(path.join(projectPath, 'docs', 'b.markdown'), '# B')
    await writeFile(path.join(projectPath, 'docs', 'sub', 'c.md'), '# C')
    await writeFile(path.join(projectPath, 'docs', 'diagram.png'), 'fake')

    const result = await renderProject(projectPath, null, 'live')

    const pagePaths = result.pages.map((p) => p.path).sort()
    expect(pagePaths).toEqual([
      'README.md',
      'docs/a.md',
      'docs/b.markdown',
      'docs/sub/c.md',
    ])

    // Referenced non-markdown file appears as an asset.
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

describe('renderProject — URL rewriter edge cases', () => {
  it('leaves fragment-only links untouched in both modes (anchors target the same page)', async () => {
    // A link like `[Section](#section)` points at a heading on the current
    // page. It must not be rewritten to `/api/file/...` or to a clean URL —
    // either would break in-page jumps.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Top\n\n## Section\n\n[jump](#section)',
    )

    for (const mode of ['live', 'build'] as const) {
      const result = await renderProject(projectPath, null, mode)
      const page = result.pages.find((p) => p.path === 'README.md')!
      expect(page.html).toMatch(/href="#section"/)
    }
  })

  it('preserves query strings on rewritten markdown links in build mode', async () => {
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n[search](./docs/install.md?q=foo)',
    )
    await writeFile(path.join(projectPath, 'docs', 'install.md'), '# Install')

    const result = await renderProject(projectPath, null, 'build')
    const readme = result.pages.find((p) => p.path === 'README.md')!
    // Build-mode rewrite must reattach the `?q=foo` suffix after the clean URL.
    expect(readme.html).toMatch(/href="\.\/docs\/install\/\?q=foo"/)
  })

  it('preserves fragment suffixes on rewritten markdown links in build mode', async () => {
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n[deep link](./docs/install.md#prereqs)',
    )
    await writeFile(path.join(projectPath, 'docs', 'install.md'), '# Install\n\n## Prereqs')

    const result = await renderProject(projectPath, null, 'build')
    const readme = result.pages.find((p) => p.path === 'README.md')!
    expect(readme.html).toMatch(/href="\.\/docs\/install\/#prereqs"/)
  })

  it('rewrites the project-root README.md to the site root "/" in build mode', async () => {
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '# Install\n\n[home](../README.md)',
    )
    await writeFile(path.join(projectPath, 'README.md'), '# Home')

    const result = await renderProject(projectPath, null, 'build')
    const install = result.pages.find((p) => p.path === 'docs/install.md')!
    // `README.md` resolves to the site root URL `/`. From the page URL
    // `/docs/install/` back to `/`, the relative path is `../../` — one
    // `..` to leave `install/`, another to leave `docs/`. The trailing
    // slash matters: it's what makes the browser fetch index.html.
    expect(install.html).toMatch(/href="\.\.\/\.\.\/"/)
    // And critically, no `.md` suffix should leak through.
    expect(install.html).not.toMatch(/href="[^"]*\.md"/)
  })

  it('leaves protocol-relative URLs (//cdn/...) untouched in both modes', async () => {
    // `//cdn.example/x.png` resolves to the page's protocol — typically used
    // for external CDN assets. The renderer must not turn these into
    // `/api/file/...` or a relative path.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n![remote](//cdn.example/x.png)',
    )

    for (const mode of ['live', 'build'] as const) {
      const result = await renderProject(projectPath, null, mode)
      const page = result.pages.find((p) => p.path === 'README.md')!
      expect(page.html).toContain('src="//cdn.example/x.png"')
    }
  })

  it('leaves data: URIs untouched on <img src>', async () => {
    // Inline data URIs (typical for tiny inline icons) must round-trip — the
    // rewriter would otherwise turn them into broken `/api/file/data:...`
    // requests. (The sanitizer schema is what decides whether a `data:` URL
    // is allowed at all; the rewriter is only asserting "pass-through".)
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    await writeFile(
      path.join(projectPath, 'README.md'),
      `# Project\n\n![dot](${dataUri})`,
    )

    for (const mode of ['live', 'build'] as const) {
      const result = await renderProject(projectPath, null, mode)
      const page = result.pages.find((p) => p.path === 'README.md')!
      // Either the sanitizer kept it (so the data: URL appears), or it
      // stripped the img entirely — in BOTH cases what must NOT happen is
      // the URL being rewritten to `/api/file/data:...`.
      expect(page.html).not.toMatch(/\/api\/file\/[^"]*data:/)
    }
  })
})

describe('renderProject — referenced-asset filtering (#74)', () => {
  it('collects <a href="report.pdf"> as a referenced asset in build mode', async () => {
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n[Download report](./report.pdf)',
    )
    await writeFile(path.join(projectPath, 'report.pdf'), 'PDF-BYTES')

    const result = await renderProject(projectPath, null, 'build')

    const assetPaths = result.assets.map((a) => a.sourcePath)
    expect(assetPaths).toContain('report.pdf')
  })

  it('deduplicates assets referenced from multiple pages', async () => {
    await mkdir(path.join(projectPath, 'docs'))
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Home\n\n![logo](./logo.png)',
    )
    await writeFile(
      path.join(projectPath, 'docs', 'about.md'),
      '# About\n\n![logo](../logo.png)',
    )
    await writeFile(path.join(projectPath, 'logo.png'), 'PNG-BYTES')

    const result = await renderProject(projectPath, null, 'build')

    // Both pages reference logo.png — it should appear exactly once.
    const assetPaths = result.assets.map((a) => a.sourcePath)
    expect(assetPaths.filter((p) => p === 'logo.png')).toHaveLength(1)
    expect(result.assets).toHaveLength(1)
  })

  it('reports missing refs and excludes them from assets', async () => {
    await writeFile(
      path.join(projectPath, 'doc.md'),
      '# Doc\n\n![missing](./missing.png)',
    )
    // missing.png is NOT written to disk

    const result = await renderProject(projectPath, null, 'build')

    expect(result.missingRefs).toHaveLength(1)
    expect(result.missingRefs[0]).toEqual({
      sourceDoc: 'doc.md',
      missingPath: 'missing.png',
    })
    const assetPaths = result.assets.map((a) => a.sourcePath)
    expect(assetPaths).not.toContain('missing.png')
    expect(result.assets).toHaveLength(0)
  })

  it('includes only the one asset referenced by <img src> — unreferenced files excluded', async () => {
    // 4 non-markdown files exist; README.md only references one via <img>.
    // After #74, result.assets must contain exactly that one file.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Project\n\n![diagram](./referenced.png)',
    )
    await writeFile(path.join(projectPath, 'referenced.png'), 'PNG-BYTES')
    await writeFile(path.join(projectPath, 'unreferenced1.png'), 'PNG-BYTES')
    await writeFile(path.join(projectPath, 'unreferenced2.pdf'), 'PDF-BYTES')
    await writeFile(path.join(projectPath, 'tsconfig.json'), '{}')

    const result = await renderProject(projectPath, null, 'build')

    expect(result.assets.length).toBe(1)
    expect(result.assets[0]!.sourcePath).toBe('referenced.png')
  })
})
