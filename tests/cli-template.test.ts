import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

describe('composePageHtml — per-site theming (#51)', () => {
  it('emits a scoped theme <style> block in <head> when themeTokens are supplied', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      themeTokens: { '--primary': '#39ff14', '--background': '#0a0e0a' },
    })

    expect(out).toContain('<style data-vd-theme>')
    expect(out).toContain('.vd-site-preview {')
    expect(out).toContain('--primary: #39ff14;')
    expect(out).toContain('--color-primary: var(--primary);')
    // The style block belongs in <head>, before the body content.
    const headEnd = out.indexOf('</head>')
    expect(out.indexOf('<style data-vd-theme>')).toBeLessThan(headEnd)
  })

  it('emits the theme style block in minimal hydration mode too', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      hydration: 'minimal',
      themeTokens: { '--primary': '#39ff14' },
    })

    expect(out).toContain('<style data-vd-theme>')
    expect(out).toContain('--primary: #39ff14;')
  })

  it('emits no theme style block when there are no tokens', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'T' })
    expect(out).not.toContain('data-vd-theme')

    const empty = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      themeTokens: {},
    })
    expect(empty).not.toContain('data-vd-theme')
  })

  it('links the theme.css escape hatch AFTER the generated stylesheet so it can override', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      stylesheet: '/assets/index-FAKEHASH.css',
      themeCssHref: '/theme.css',
    })

    expect(out).toContain('<link rel="stylesheet" href="/theme.css">')
    const genIdx = out.indexOf('/assets/index-FAKEHASH.css')
    const themeIdx = out.indexOf('/theme.css')
    expect(genIdx).toBeGreaterThan(-1)
    expect(themeIdx).toBeGreaterThan(genIdx)
  })

  it('escapes the theme.css href to avoid attribute injection', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index.js',
      title: 'T',
      themeCssHref: '/theme.css"><script>alert(1)</script>',
    })

    expect(out).not.toContain('<script>alert(1)</script>')
  })

  it('does not link theme.css when no href is supplied', () => {
    const out = composePageHtml(page(), { bundleEntry: '/assets/index.js', title: 'T' })
    expect(out).not.toContain('theme.css')
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

  it('sets window.__VIBEDOCS_STATIC=true before the app bundle in full mode (#151)', () => {
    const out = composePageHtml(page(), {
      bundleEntry: '/assets/index-abc.js',
      title: 'T',
      hydration: 'full',
    })

    // The static flag must be present so live-only UI (the #58 project
    // switcher, gated by is-static.ts) self-suppresses in static output.
    expect(out).toContain('window.__VIBEDOCS_STATIC=true')
    // ...and it must run BEFORE the app bundle, so isStaticBuild() reads true
    // before any React component mounts.
    const flagIdx = out.indexOf('window.__VIBEDOCS_STATIC=true')
    const bundleIdx = out.indexOf('src="/assets/index-abc.js"')
    expect(flagIdx).toBeGreaterThan(-1)
    expect(bundleIdx).toBeGreaterThan(-1)
    expect(flagIdx).toBeLessThan(bundleIdx)
  })

  it('does not set the static flag in the live frontend/index.html (#151)', () => {
    // The live SPA is served from frontend/index.html (a separate Vite file we
    // must never touch). Its CSP is `script-src 'self'` — no inline scripts —
    // and it must NEVER claim to be a static build.
    const indexHtmlPath = fileURLToPath(
      new URL('../frontend/index.html', import.meta.url),
    )
    const liveHtml = readFileSync(indexHtmlPath, 'utf8')
    expect(liveHtml).not.toContain('__VIBEDOCS_STATIC')
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
