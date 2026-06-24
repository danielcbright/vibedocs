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

describe('composePageHtml — SEO meta (#50)', () => {
  const seo = {
    title: 'Install Guide',
    description: 'How to install the thing.',
    ogTitle: 'Install Guide',
    ogDescription: 'How to install the thing.',
    ogImage: 'https://cdn.example/og.png',
    canonical: 'https://docs.example.com/docs/install/',
    twitterCard: 'summary_large_image' as const,
    twitterSite: '@vibedocs',
    noindex: false,
  }

  it('emits a description meta from seo.description', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'Install Guide',
      seo,
    })
    expect(out).toContain('<meta name="description" content="How to install the thing.">')
  })

  it('emits og:title, og:description, og:image, og:url', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'Install Guide',
      seo,
    })
    expect(out).toContain('<meta property="og:title" content="Install Guide">')
    expect(out).toContain('<meta property="og:description" content="How to install the thing.">')
    expect(out).toContain('<meta property="og:image" content="https://cdn.example/og.png">')
    expect(out).toContain('<meta property="og:url" content="https://docs.example.com/docs/install/">')
  })

  it('emits a canonical link', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'Install Guide',
      seo,
    })
    expect(out).toContain('<link rel="canonical" href="https://docs.example.com/docs/install/">')
  })

  it('emits twitter:card and twitter:site', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'Install Guide',
      seo,
    })
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(out).toContain('<meta name="twitter:site" content="@vibedocs">')
  })

  it('emits a robots noindex meta only when seo.noindex is true', () => {
    const indexed = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      seo,
    })
    expect(indexed).not.toContain('name="robots"')

    const hidden = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      seo: { ...seo, noindex: true },
    })
    expect(hidden).toContain('<meta name="robots" content="noindex">')
  })

  it('omits optional tags when their seo fields are absent', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      seo: {
        title: 'T',
        ogTitle: 'T',
        canonical: 'https://docs.example.com/',
        twitterCard: 'summary' as const,
        noindex: false,
      },
    })
    expect(out).not.toContain('name="description"')
    expect(out).not.toContain('property="og:image"')
    expect(out).not.toContain('property="og:description"')
    expect(out).not.toContain('name="twitter:site"')
    // og:title, og:url, canonical, twitter:card are always present.
    expect(out).toContain('property="og:title"')
    expect(out).toContain('property="og:url"')
    expect(out).toContain('rel="canonical"')
    expect(out).toContain('name="twitter:card"')
  })

  it('escapes attacker-controlled seo values in attribute context', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      seo: {
        ...seo,
        description: 'Evil "><script>alert(1)</script>',
      },
    })
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('emits no SEO meta block when no seo option is supplied (back-compat)', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'T' })
    expect(out).not.toContain('property="og:title"')
    expect(out).not.toContain('rel="canonical"')
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

  it('renders semantic curated nav when hydration=minimal AND siteConfigNav provided', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
      siteConfigNav: {
        sections: [
          { label: 'Getting Started', items: ['README.md', 'docs/install.md'] },
          { label: 'Reference', items: ['docs/api.md'] },
        ],
      },
      // Flat fallback is supplied alongside so the test asserts the curated
      // nav WINS, not that flat is missing globally.
      navLinks: [{ url: '/', label: 'Home' }, { url: '/docs/install/', label: 'Install' }],
    })

    // a11y: nav landmark explicitly labelled.
    expect(out).toContain('<nav aria-label="Main navigation">')
    // Section labels rendered as headings (the markup choice is <h2> inside
    // the curated nav; we only require that the label text is present).
    expect(out).toContain('Getting Started')
    expect(out).toContain('Reference')
    // Items become clean URLs — README.md → `/`, docs/install.md → `/docs/install/`.
    expect(out).toContain('href="/"')
    expect(out).toContain('href="/docs/install/"')
    expect(out).toContain('href="/docs/api/"')
    // The flat fallback's data-attr should NOT appear when the curated nav wins.
    expect(out).not.toContain('data-vd-fallback-nav')
  })

  it('injects the PWA head tags in FULL mode (manifest, theme-color, iOS meta)', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'full',
      pwa: { themeColor: '#0ea5e9', appTitle: 'My Docs' },
    })
    expect(out).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(out).toContain('name="theme-color"')
    expect(out).toContain('#0ea5e9')
    expect(out).toContain('apple-mobile-web-app-capable')
    // SW registration script present (and NOT type=module so minimal-mode
    // contract is untouched).
    expect(out).toContain('src="/sw-register.js"')
  })

  it('injects the PWA head tags in MINIMAL mode too (SW is the only JS)', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
      pwa: { themeColor: '#0ea5e9', appTitle: 'My Docs' },
    })
    expect(out).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(out).toContain('name="theme-color"')
    // SW registration script must ship even with no SPA bundle.
    expect(out).toContain('src="/sw-register.js"')
    // ...but it must NOT be a module script (minimal-mode contract).
    expect(out).not.toContain('<script type="module"')
  })

  it('omits PWA tags entirely when no pwa option is supplied (back-compat)', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'T' })
    expect(out).not.toContain('rel="manifest"')
    expect(out).not.toContain('/sw-register.js')
  })

  it('falls back to flat-link nav when hydration=minimal AND siteConfigNav is absent', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
      navLinks: [
        { url: '/', label: 'Home' },
        { url: '/docs/install/', label: 'Install' },
      ],
    })

    // Curated nav landmark must NOT appear.
    expect(out).not.toContain('aria-label="Main navigation"')
    // Flat-link nav DOES — same shape as full-mode no-JS fallback.
    expect(out).toContain('data-vd-fallback-nav')
    expect(out).toContain('href="/docs/install/"')
    expect(out).toContain('>Install<')
  })
})
