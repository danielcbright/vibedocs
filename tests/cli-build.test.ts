import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, readFile, stat, readdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import { runBuild, resolveProjectPath } from '../src/cli/build.js'

// ── helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string
let projectsRoot: string
let projectPath: string
let outDir: string
let frontendDist: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-build-cli-'))
  projectsRoot = path.join(tmpDir, 'projects')
  projectPath = path.join(projectsRoot, 'myproject')
  outDir = path.join(tmpDir, 'dist')
  frontendDist = path.join(tmpDir, 'frontend-dist')

  await mkdir(projectPath, { recursive: true })
  await mkdir(path.join(projectPath, 'docs'))
  await writeFile(path.join(projectPath, 'README.md'), '# My Project\n\nWelcome.')
  await writeFile(
    path.join(projectPath, 'docs', 'install.md'),
    '# Install\n\nRun `npm install`.\n\n![diagram](./images/diagram.png)',
  )
  // An asset referenced by docs/install.md above.
  await mkdir(path.join(projectPath, 'docs', 'images'))
  await writeFile(path.join(projectPath, 'docs', 'images', 'diagram.png'), 'PNG-FAKE-BYTES')

  // Minimal pretend "frontend build" output.
  await mkdir(path.join(frontendDist, 'assets'), { recursive: true })
  await writeFile(
    path.join(frontendDist, 'index.html'),
    '<!doctype html><html><head><title>X</title>'
      + '<script type="module" src="/assets/index-FAKEHASH.js"></script>'
      + '<link rel="stylesheet" href="/assets/index-FAKEHASH.css">'
      + '</head><body><div id="root"></div></body></html>',
  )
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKEHASH.js'), 'console.log("hi")')
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKEHASH.css'), 'body{margin:0}')

  // PWA icon/favicon set — Vite mirrors frontend/public/* into frontend/dist/.
  for (const icon of [
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
    'favicon.svg',
    'favicon.ico',
    'favicon-dark.png',
    'favicon-light.png',
  ]) {
    await writeFile(path.join(frontendDist, icon), `FAKE-${icon}`)
  }
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('runBuild — file emission', () => {
  it('emits one HTML file per markdown source at clean URLs', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    // README.md → dist/index.html (site root)
    expect(await pathExists(path.join(outDir, 'index.html'))).toBe(true)
    // docs/install.md → dist/docs/install/index.html
    expect(await pathExists(path.join(outDir, 'docs', 'install', 'index.html'))).toBe(true)
  })

  it('copies the React bundle from frontend-dist/assets/ into <out>/assets/', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.js'))).toBe(true)
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.css'))).toBe(true)
  })

  it('mirrors non-markdown asset files to dist/<source-path>', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const mirroredAsset = path.join(outDir, 'docs', 'images', 'diagram.png')
    expect(await pathExists(mirroredAsset)).toBe(true)
    const bytes = await readFile(mirroredAsset, 'utf-8')
    expect(bytes).toBe('PNG-FAKE-BYTES')
  })

  it('embeds the rendered page html and references the bundle entry script', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const installHtml = await readFile(
      path.join(outDir, 'docs', 'install', 'index.html'),
      'utf-8',
    )
    expect(installHtml).toMatch(/<h1[^>]*>.*Install.*<\/h1>/s)
    expect(installHtml).toContain('npm install')
    // Bundle entry is auto-detected from frontend-dist/index.html's <script>
    expect(installHtml).toContain('src="/assets/index-FAKEHASH.js"')
    expect(installHtml).toContain('<meta charset="UTF-8"')
  })

  it('uses page H1 as the <title> when available', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const html = await readFile(
      path.join(outDir, 'docs', 'install', 'index.html'),
      'utf-8',
    )
    expect(html).toMatch(/<title>Install<\/title>/)
  })
})

describe('runBuild — per-page SEO meta (#50)', () => {
  async function writeConfig() {
    await writeFile(
      path.join(projectPath, '.vibedocs.config.ts'),
      `export default {
        name: 'My Docs',
        domain: 'docs.example.com',
        description: 'Site-level description.',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
        seo: { ogImage: 'https://cdn.example/default.png', twitterHandle: '@vibedocs' },
      }`,
      'utf8',
    )
  }

  it('uses frontmatter.title for <title> while leaving the body H1 untouched', async () => {
    await writeConfig()
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '---\ntitle: Installation Steps\ndescription: How to install.\n---\n# Install\n\nRun `npm install`.',
    )

    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const html = await readFile(path.join(outDir, 'docs', 'install', 'index.html'), 'utf-8')
    // Frontmatter title drives <title>...
    expect(html).toMatch(/<title>Installation Steps<\/title>/)
    // ...but the author's H1 in the body is untouched.
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Install[\s\S]*<\/h1>/)
    expect(html).not.toContain('Installation Steps</h1>')
    // No raw frontmatter leaks into the body.
    expect(html).not.toContain('How to install.</p>')
  })

  it('emits per-page description + og + canonical from frontmatter and siteConfig', async () => {
    await writeConfig()
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '---\ntitle: Installation Steps\ndescription: How to install.\n---\n# Install',
    )

    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://docs.example.com',
    })

    const html = await readFile(path.join(outDir, 'docs', 'install', 'index.html'), 'utf-8')
    expect(html).toContain('<meta name="description" content="How to install.">')
    expect(html).toContain('<meta property="og:title" content="Installation Steps">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/default.png">')
    expect(html).toContain('<meta name="twitter:site" content="@vibedocs">')
    expect(html).toContain('<link rel="canonical" href="https://docs.example.com/docs/install/">')
  })

  it('falls back to siteConfig.description + ogImage for a page with no frontmatter', async () => {
    await writeConfig()
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://docs.example.com',
    })

    // README.md has no frontmatter — H1 "My Project" → <title>, site
    // description + default og:image fill in.
    const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).toMatch(/<title>My Project<\/title>/)
    expect(html).toContain('<meta name="description" content="Site-level description.">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/default.png">')
  })

  it('emits a robots noindex meta and excludes the page from the sitemap when frontmatter.noindex is true', async () => {
    await writeConfig()
    await writeFile(
      path.join(projectPath, 'docs', 'install.md'),
      '---\nnoindex: true\n---\n# Secret Install',
    )

    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://docs.example.com',
    })

    const html = await readFile(path.join(outDir, 'docs', 'install', 'index.html'), 'utf-8')
    expect(html).toContain('<meta name="robots" content="noindex">')

    // The noindex page must NOT appear in sitemap.xml.
    const xml = await readFile(path.join(outDir, 'sitemap.xml'), 'utf-8')
    expect(xml).not.toContain('/docs/install/')
    // ...but the indexed root page still does.
    expect(xml).toContain('<loc>https://docs.example.com/</loc>')
  })
})

describe('runBuild — base URL', () => {
  it('threads --base-url through (presence check; full canonical lands in slice #5)', async () => {
    // For slice #49 we only need to prove the option doesn't crash and the
    // build completes. Real canonical-URL emission is slice #50/#54.
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://example.com',
    })

    expect(await pathExists(path.join(outDir, 'index.html'))).toBe(true)
  })
})

describe('runBuild — error paths', () => {
  it('throws an actionable error when the project does not exist', async () => {
    await expect(
      runBuild({
        projectName: 'does-not-exist',
        projectsRoot,
        outDir,
        frontendDist,
      }),
    ).rejects.toThrow(/does-not-exist/)
  })

  it('throws when frontend-dist has no built bundle', async () => {
    await rm(frontendDist, { recursive: true, force: true })
    await mkdir(frontendDist, { recursive: true })

    await expect(
      runBuild({
        projectName: 'myproject',
        projectsRoot,
        outDir,
        frontendDist,
      }),
    ).rejects.toThrow(/frontend.*build|bundle/i)
  })

  it("surfaces the loader's actionable, field-path-aware error for an invalid site config", async () => {
    // A config missing the required `name` field. loadSiteConfig validates it
    // and throws VibedocsError('invalid', '.vibedocs.config.ts: missing
    // required field: name'). runBuild must let that message reach the caller
    // verbatim — naming the file AND the offending field — not bury it behind a
    // generic prefix.
    await writeFile(
      path.join(projectPath, '.vibedocs.config.ts'),
      `export default {
        domain: 'docs.example.com',
        description: 'no name field',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }`,
      'utf8',
    )

    await expect(
      runBuild({
        projectName: 'myproject',
        projectsRoot,
        outDir,
        frontendDist,
      }),
    ).rejects.toThrow(/\.vibedocs\.config\.ts: missing required field: name/)
  })
})

describe('runBuild — referenced-asset filtering and summary (#74)', () => {
  async function collectDistFiles(dir: string, base = dir): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        result.push(...await collectDistFiles(full, base))
      } else {
        result.push(path.relative(base, full))
      }
    }
    return result
  }

  it('dist/ contains no .ts files, no package.json when project has source-tree noise', async () => {
    // Add source-tree noise that should NOT appear in dist/ because no doc
    // references it.
    await writeFile(path.join(projectPath, 'server.ts'), 'export {}')
    await writeFile(path.join(projectPath, 'package.json'), '{"name":"noise"}')
    await writeFile(path.join(projectPath, 'LICENSE'), 'MIT')

    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const files = await collectDistFiles(outDir)
    const tsFiles = files.filter((f) => f.endsWith('.ts'))
    const pkgFiles = files.filter((f) => f.endsWith('package.json'))
    const licFiles = files.filter((f) => f === 'LICENSE')
    expect(tsFiles).toHaveLength(0)
    expect(pkgFiles).toHaveLength(0)
    expect(licFiles).toHaveLength(0)
  })

  it('build summary contains "Copied N referenced assets"', async () => {
    const stdoutLines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stdoutLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stdoutLines.join('')
    expect(combined).toMatch(/Copied \d+ referenced assets/)
  })

  it('emits a warning to stderr for each missing asset reference', async () => {
    // README.md references a file that does not exist on disk.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# My Project\n\nWelcome.\n\n![missing](./ghost.png)',
    )

    const stderrLines: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stderrLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stderrLines.join('')
    expect(combined).toMatch(/warning:.*README\.md.*references.*ghost\.png.*does not exist/)
  })
})

describe('runBuild — hydration policy (#76)', () => {
  it('with hydration="minimal", skips copying the SPA JS bundle but preserves the CSS file the <link> still references', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      hydration: 'minimal',
    })

    // SPA JS bundle NOT copied.
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.js'))).toBe(false)
    // BUT — the CSS file IS still copied, because the emitted HTML still has
    // a <link rel="stylesheet" href=".../index-FAKEHASH.css"> and the page
    // needs Shiki + prose styles to look correct. Spec: "Preserve the CSS link."
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.css'))).toBe(true)
    // User-content asset (referenced by docs/install.md) IS copied — separate
    // code path from the SPA bundle.
    expect(await pathExists(path.join(outDir, 'docs', 'images', 'diagram.png'))).toBe(true)
  })

  it('with hydration="minimal", emitted HTML contains NO <script type="module"> tag', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      hydration: 'minimal',
    })

    const rootHtml = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(rootHtml).not.toContain('<script type="module"')

    const installHtml = await readFile(
      path.join(outDir, 'docs', 'install', 'index.html'),
      'utf-8',
    )
    expect(installHtml).not.toContain('<script type="module"')
  })

  it('with hydration="minimal" AND a siteConfig.nav.sections, emits <nav aria-label="Main navigation">', async () => {
    // Drop a .vibedocs.config.ts at the project root configuring curated nav.
    const configSource = `
      export default {
        name: 'myproject',
        domain: 'example.com',
        description: 'd',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
        nav: {
          sections: [
            { label: 'Getting Started', items: ['README.md', 'docs/install.md'] },
          ],
        },
      }
    `
    await writeFile(path.join(projectPath, '.vibedocs.config.ts'), configSource, 'utf8')

    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      hydration: 'minimal',
    })

    const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('<nav aria-label="Main navigation">')
    expect(html).toContain('Getting Started')
    expect(html).toContain('href="/docs/install/"')
    // Flat-fallback nav must not appear when curated wins.
    expect(html).not.toContain('data-vd-fallback-nav')
  })

  it('with hydration="minimal" AND NO siteConfig.nav, falls back to the flat-link nav', async () => {
    // No .vibedocs.config.ts at all — runBuild defaults siteConfig to null.
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      hydration: 'minimal',
    })

    const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).not.toContain('aria-label="Main navigation"')
    expect(html).toContain('data-vd-fallback-nav')
    // The page links the renderer found should be present as flat <a>s.
    expect(html).toContain('href="/docs/install/"')
  })

  it('with hydration="full" (default), preserves today\'s behaviour — SPA bundle copied AND script tag present', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      // No `hydration` field — exercises the default-to-'full' path.
    })

    // SPA bundle copied.
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.js'))).toBe(true)
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.css'))).toBe(true)
    // Script tag present in emitted HTML.
    const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('<script type="module"')
  })

  it('emits a "Hydration policy: minimal" summary line with saved-bytes context', async () => {
    const stdoutLines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stdoutLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({
        projectName: 'myproject',
        projectsRoot,
        outDir,
        frontendDist,
        hydration: 'minimal',
      })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stdoutLines.join('')
    expect(combined).toMatch(/Hydration policy: minimal/)
    // Saved-bytes context: the would-have-been-copied SPA bundle is summed.
    expect(combined).toMatch(/saved/i)
  })

  it('emits a "Hydration policy: full (SPA bundle copied — N files, ~XXX)" summary line in full mode', async () => {
    const stdoutLines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stdoutLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({
        projectName: 'myproject',
        projectsRoot,
        outDir,
        frontendDist,
        hydration: 'full',
      })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stdoutLines.join('')
    expect(combined).toMatch(/Hydration policy: full/)
    expect(combined).toMatch(/SPA bundle copied/)
  })
})

describe('runBuild — PWA emission (#143)', () => {
  for (const hydration of ['full', 'minimal'] as const) {
    describe(`hydration=${hydration}`, () => {
      it('writes manifest.webmanifest, sw.js, sw-register.js and copies the icon set', async () => {
        await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist, hydration })

        expect(await pathExists(path.join(outDir, 'manifest.webmanifest'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'sw.js'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'sw-register.js'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'icon-192.png'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'icon-512.png'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'icon-maskable-512.png'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'apple-touch-icon.png'))).toBe(true)
        expect(await pathExists(path.join(outDir, 'favicon.svg'))).toBe(true)
      })

      it('emitted pages link the manifest + register the SW', async () => {
        await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist, hydration })

        const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
        expect(html).toContain('rel="manifest"')
        expect(html).toContain('href="/manifest.webmanifest"')
        expect(html).toContain('name="theme-color"')
        expect(html).toContain('src="/sw-register.js"')
      })

      it('manifest is valid JSON referencing the icons', async () => {
        await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist, hydration })

        const raw = await readFile(path.join(outDir, 'manifest.webmanifest'), 'utf-8')
        const manifest = JSON.parse(raw) as { icons: { src: string }[]; display: string }
        expect(manifest.display).toBe('standalone')
        expect(manifest.icons.map((i) => i.src)).toContain('/icon-192.png')
      })

      it('sw.js is self-contained and references the precached shell', async () => {
        await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist, hydration })

        const sw = await readFile(path.join(outDir, 'sw.js'), 'utf-8')
        expect(sw).toContain('/manifest.webmanifest')
        expect(sw).toContain("addEventListener('fetch'")
      })
    })
  }

  it('derives manifest short_name + theme_color from siteConfig', async () => {
    const configSource = `
      export default {
        name: 'Cirrus Docs',
        domain: 'example.com',
        description: 'Weather docs.',
        theme: { tokens: { '--primary': '#0ea5e9' } },
        llms: { summary: 's', keyDocs: [] },
      }
    `
    await writeFile(path.join(projectPath, '.vibedocs.config.ts'), configSource, 'utf8')

    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const manifest = JSON.parse(
      await readFile(path.join(outDir, 'manifest.webmanifest'), 'utf-8'),
    ) as { name: string; short_name: string; theme_color: string }
    expect(manifest.name).toBe('Cirrus Docs')
    expect(manifest.short_name).toBe('Cirrus Docs')
    expect(manifest.theme_color).toBe('#0ea5e9')

    const html = await readFile(path.join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('content="#0ea5e9"')
  })
})

describe('runBuild — sitemap + robots emission (#54)', () => {
  async function writeConfig(domain: string) {
    await writeFile(
      path.join(projectPath, '.vibedocs.config.ts'),
      `export default {
        name: 'My Project',
        domain: ${JSON.stringify(domain)},
        description: 'Docs.',
        theme: { tokens: {} },
        llms: { summary: 's', keyDocs: [] },
      }`,
      'utf8',
    )
  }

  it('emits sitemap.xml with absolute URLs derived from siteConfig.domain', async () => {
    await writeConfig('docs.example.com')
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const xml = await readFile(path.join(outDir, 'sitemap.xml'), 'utf-8')
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    // README.md → site root; docs/install.md → /docs/install/
    expect(xml).toContain('<loc>https://docs.example.com/</loc>')
    expect(xml).toContain('<loc>https://docs.example.com/docs/install/</loc>')
  })

  it('emits a permissive robots.txt referencing the sitemap', async () => {
    await writeConfig('docs.example.com')
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const txt = await readFile(path.join(outDir, 'robots.txt'), 'utf-8')
    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Allow: /')
    expect(txt).toContain('Sitemap: https://docs.example.com/sitemap.xml')
  })

  it('prefers an explicit --base-url over siteConfig.domain', async () => {
    await writeConfig('docs.example.com')
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://canonical.example.org',
    })

    const xml = await readFile(path.join(outDir, 'sitemap.xml'), 'utf-8')
    expect(xml).toContain('<loc>https://canonical.example.org/</loc>')
    const txt = await readFile(path.join(outDir, 'robots.txt'), 'utf-8')
    expect(txt).toContain('Sitemap: https://canonical.example.org/sitemap.xml')
  })

  // noindex exclusion: runBuild threads each page's `frontmatter` straight
  // into formatSitemap, which drops `noindex: true` pages. The exclusion
  // logic itself is pinned exhaustively in tests/cli-sitemap.test.ts. We
  // can't drive it end-to-end here until frontmatter parsing lands (slice
  // #50) — renderProject currently hardcodes `frontmatter: {}` — so this
  // test asserts the wiring contract: a built page that DOES carry the flag
  // is excluded. We synthesize that by stubbing renderProject's output shape
  // is overkill; instead we trust the unit test + verify the seam exists by
  // confirming the sitemap is built from result.pages (every emitted page
  // appears, none extra).
  it('lists exactly the rendered markdown pages (sitemap built from result.pages)', async () => {
    await writeConfig('example.com')
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const xml = await readFile(path.join(outDir, 'sitemap.xml'), 'utf-8')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.sort()).toEqual([
      'https://example.com/',
      'https://example.com/docs/install/',
    ])
  })

  it('still emits sitemap + robots without a siteConfig, using --base-url', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://nodomain.example',
    })

    expect(await pathExists(path.join(outDir, 'sitemap.xml'))).toBe(true)
    expect(await pathExists(path.join(outDir, 'robots.txt'))).toBe(true)
    const xml = await readFile(path.join(outDir, 'sitemap.xml'), 'utf-8')
    expect(xml).toContain('<loc>https://nodomain.example/</loc>')
  })
})

describe('runBuild — llms.txt + .md.txt emission (#53)', () => {
  async function writeConfig(extra = '') {
    await writeFile(
      path.join(projectPath, '.vibedocs.config.ts'),
      `export default {
        name: 'My Project',
        domain: 'docs.example.com',
        description: 'Docs.',
        theme: { tokens: {} },
        llms: { summary: 'A delightful docs site.', keyDocs: ['README.md'] },
        ${extra}
      }`,
      'utf8',
    )
  }

  it('emits dist/llms.txt with H1, blockquote summary, and two H2 sections', async () => {
    await writeConfig()
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const txt = await readFile(path.join(outDir, 'llms.txt'), 'utf-8')
    expect(txt.startsWith('# My Project\n')).toBe(true)
    expect(txt).toContain('> A delightful docs site.')
    expect(txt).toContain('## Key documentation')
    expect(txt).toContain('## Full docs')
    // README.md is a keyDoc → site root URL, listed under Key documentation.
    expect(txt).toContain('[My Project](https://docs.example.com/)')
    // docs/install.md is NOT a keyDoc → Full docs section.
    expect(txt).toContain('[Install](https://docs.example.com/docs/install/)')
  })

  it('lists each keyDoc once — excluded from Full docs (no duplication)', async () => {
    await writeConfig()
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const txt = await readFile(path.join(outDir, 'llms.txt'), 'utf-8')
    const rootCount = (txt.match(/\(https:\/\/docs\.example\.com\/\)/g) ?? []).length
    expect(rootCount).toBe(1)
  })

  it('mirror-emits every source .md as dist/<path>.md.txt with raw content', async () => {
    await writeConfig()
    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    // docs/install.md → dist/docs/install.md.txt (raw markdown, not HTML)
    const rawInstall = path.join(outDir, 'docs', 'install.md.txt')
    expect(await pathExists(rawInstall)).toBe(true)
    const installSrc = await readFile(path.join(projectPath, 'docs', 'install.md'), 'utf-8')
    const installMirror = await readFile(rawInstall, 'utf-8')
    expect(installMirror).toBe(installSrc)
    // README.md → dist/README.md.txt
    const rawReadme = path.join(outDir, 'README.md.txt')
    expect(await pathExists(rawReadme)).toBe(true)
    const readmeMirror = await readFile(rawReadme, 'utf-8')
    expect(readmeMirror).toBe(await readFile(path.join(projectPath, 'README.md'), 'utf-8'))
    // The mirror is raw — no HTML wrapping.
    expect(installMirror).not.toContain('<html')
    expect(installMirror).not.toContain('<h1')
  })

  it('skips llms.txt when no siteConfig is present (no site identity)', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://nodomain.example',
    })
    expect(await pathExists(path.join(outDir, 'llms.txt'))).toBe(false)
    // .md.txt mirroring is independent of siteConfig — it still happens.
    expect(await pathExists(path.join(outDir, 'README.md.txt'))).toBe(true)
  })
})

describe('resolveProjectPath', () => {
  it('returns <root>/<name> when that directory exists', async () => {
    const resolved = await resolveProjectPath('myproject', projectsRoot, projectsRoot)
    expect(resolved).toBe(projectPath)
  })

  it('falls back to cwd when its basename matches the project name', async () => {
    // Simulates `vibedocs build --project vibedocs` run from inside the
    // vibedocs repo itself, where there is no `vibedocs/vibedocs/` subdir.
    const standaloneRoot = path.join(tmpDir, 'standalone-root')
    await mkdir(standaloneRoot)
    const vibedocsLike = path.join(standaloneRoot, 'vibedocs')
    await mkdir(vibedocsLike)
    await writeFile(path.join(vibedocsLike, 'README.md'), '# v')

    const resolved = await resolveProjectPath(
      'vibedocs',
      standaloneRoot, // PROJECTS_DIR
      vibedocsLike, // cwd
    )
    expect(resolved).toBe(vibedocsLike)
  })

  it('falls back to cwd when the local package.json name matches', async () => {
    // Simulates running from a worktree dir whose basename is a branch slug
    // (e.g. agent-abc123), where the package.json there declares the project
    // name. This is how `npx tsx bin/vibedocs build --project vibedocs` works
    // from inside a vibedocs worktree.
    const worktreeDir = path.join(tmpDir, 'worktree-xyz')
    await mkdir(worktreeDir)
    await writeFile(
      path.join(worktreeDir, 'package.json'),
      JSON.stringify({ name: 'pkgname', version: '0.0.0' }),
    )

    const resolved = await resolveProjectPath(
      'pkgname',
      path.join(tmpDir, 'no-such-projects-root'),
      worktreeDir,
    )
    expect(resolved).toBe(worktreeDir)
  })

  it('throws when neither the sibling nor the cwd matches', async () => {
    await expect(
      resolveProjectPath('nope', projectsRoot, projectsRoot),
    ).rejects.toThrow(/nope/)
  })
})
