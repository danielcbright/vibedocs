import { describe, it, expect } from 'vitest'
import { composePageHtml } from '../src/cli/template.js'
import type { HtmlPage } from '../src/render.js'

const page = (overrides: Partial<HtmlPage> = {}): HtmlPage => ({
  path: 'README.md',
  url: '/',
  html: '<h1>Hello</h1><p>Body.</p>',
  toc: [],
  frontmatter: {},
  ...overrides,
})

describe('composePageHtml — minimal template (slice #49)', () => {
  it('wraps the page html inside <html>/<head>/<body>', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'Hello' })

    expect(out).toMatch(/^<!doctype html>/i)
    expect(out).toContain('<html lang="en">')
    expect(out).toContain('</html>')
    expect(out).toContain('<head>')
    expect(out).toContain('</head>')
    expect(out).toContain('<body>')
    expect(out).toContain('</body>')
  })

  it('emits charset and viewport meta tags', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'X' })

    expect(out).toContain('<meta charset="UTF-8"')
    expect(out).toContain('<meta name="viewport"')
  })

  it('places the page html inside a content container in the body', () => {
    const out = composePageHtml(page({ html: '<h1>UNIQUE_BODY_42</h1>' }), {
      bundleEntry: '/assets/index.js',
      title: 'T',
    })

    expect(out).toContain('<h1>UNIQUE_BODY_42</h1>')
    // Content must appear after <body>
    const bodyIdx = out.indexOf('<body>')
    const contentIdx = out.indexOf('UNIQUE_BODY_42')
    expect(bodyIdx).toBeGreaterThan(-1)
    expect(contentIdx).toBeGreaterThan(bodyIdx)
  })

  it('uses the page title as the <title>', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'My Page Title' })

    expect(out).toMatch(/<title>My Page Title<\/title>/)
  })

  it('references the React bundle entry via <script type="module">', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index-abc123.js',
      title: 'T',
    })

    expect(out).toContain('<script type="module" src="/assets/index-abc123.js"></script>')
  })

  it('escapes the title to avoid HTML injection', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'Hack & <script>alert(1)</script>',
    })

    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('Hack &amp; &lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('emits a placeholder div for the SPA mount', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'T' })

    expect(out).toContain('id="root"')
  })

  it('includes a plain-link nav listing the supplied pages (no JS required)', () => {
    const out = composePageHtml(page({ url: '/' }), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      navLinks: [
        { url: '/', label: 'Home' },
        { url: '/docs/install/', label: 'Install' },
      ],
    })

    expect(out).toContain('href="/"')
    expect(out).toContain('>Home<')
    expect(out).toContain('href="/docs/install/"')
    expect(out).toContain('>Install<')
  })
})

describe('composePageHtml — hydration policy (#76)', () => {
  it('omits the <script type="module"> tag when hydration === "minimal"', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
    })
    expect(out).not.toContain('<script type="module"')
    // CSS link is still preserved when supplied — minimal mode keeps Shiki +
    // prose styles.
    const css = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
      stylesheet: '/assets/index-FAKEHASH.css',
    })
    expect(css).toContain('rel="stylesheet"')
    expect(css).toContain('/assets/index-FAKEHASH.css')
  })

  it('keeps the <script type="module"> tag when hydration === "full" (default behaviour)', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index-abc.js',
      title: 'T',
      hydration: 'full',
    })
    expect(out).toContain('<script type="module" src="/assets/index-abc.js"></script>')
  })

  it('treats omitted hydration as "full" (back-compat)', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
    })
    expect(out).toContain('<script type="module"')
  })
})
