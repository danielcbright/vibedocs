import { describe, it, expect } from 'vitest'
import { resolvePageSeo } from '../src/cli/seo.js'
import type { HtmlPage } from '../src/render.js'
import type { SiteConfig } from '../src/shared/site-config-types.js'

const page = (overrides: Partial<HtmlPage> = {}): HtmlPage => ({
  path: 'docs/install.md',
  url: '/docs/install/',
  html: '<h1>Install Guide</h1><p>Body.</p>',
  toc: [],
  frontmatter: {},
  ...overrides,
})

const siteConfig = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  name: 'My Docs',
  domain: 'docs.example.com',
  description: 'Site-level description.',
  theme: { tokens: {} },
  llms: { summary: 's', keyDocs: [] },
  ...overrides,
})

describe('resolvePageSeo — title resolution', () => {
  it('prefers frontmatter.title over the H1', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { title: 'Frontmatter Title' } }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.title).toBe('Frontmatter Title')
  })

  it('falls back to the first H1 text when frontmatter has no title', () => {
    const seo = resolvePageSeo({
      page: page({ html: '<h1><a class="heading-anchor">Install Guide</a></h1>' }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.title).toBe('Install Guide')
  })

  it('falls back to the filename when there is neither frontmatter title nor H1', () => {
    const seo = resolvePageSeo({
      page: page({ path: 'docs/install.md', html: '<p>No heading.</p>' }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.title).toBe('install')
  })
})

describe('resolvePageSeo — description resolution', () => {
  it('prefers frontmatter.description over the site description', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { description: 'Page-level blurb.' } }),
      siteConfig: siteConfig({ description: 'Site-level description.' }),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.description).toBe('Page-level blurb.')
  })

  it('falls back to siteConfig.description when frontmatter has none', () => {
    const seo = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig({ description: 'Site-level description.' }),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.description).toBe('Site-level description.')
  })

  it('leaves description undefined when neither frontmatter nor siteConfig supplies one', () => {
    const seo = resolvePageSeo({
      page: page(),
      siteConfig: null,
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.description).toBeUndefined()
  })
})

describe('resolvePageSeo — canonical URL', () => {
  it('joins the base URL with the page clean URL', () => {
    const seo = resolvePageSeo({
      page: page({ url: '/docs/install/' }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.canonical).toBe('https://docs.example.com/docs/install/')
  })

  it('collapses the slash seam between base URL and root page URL', () => {
    const seo = resolvePageSeo({
      page: page({ url: '/' }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com/',
    })
    expect(seo.canonical).toBe('https://docs.example.com/')
  })
})

describe('resolvePageSeo — Open Graph + Twitter', () => {
  it('og:title and og:description default to the resolved title + description', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { title: 'T', description: 'D' } }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.ogTitle).toBe('T')
    expect(seo.ogDescription).toBe('D')
  })

  it('resolves og:image from frontmatter.og_image first', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { og_image: 'https://cdn.example/page.png' } }),
      siteConfig: siteConfig({ seo: { ogImage: 'https://cdn.example/default.png' } }),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.ogImage).toBe('https://cdn.example/page.png')
  })

  it('falls back to siteConfig.seo.ogImage when frontmatter has no og_image', () => {
    const seo = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig({ seo: { ogImage: 'https://cdn.example/default.png' } }),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.ogImage).toBe('https://cdn.example/default.png')
  })

  it('uses summary_large_image when an og:image is present, summary otherwise', () => {
    const withImage = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig({ seo: { ogImage: 'https://cdn.example/x.png' } }),
      baseUrl: 'https://docs.example.com',
    })
    const without = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(withImage.twitterCard).toBe('summary_large_image')
    expect(without.twitterCard).toBe('summary')
  })

  it('exposes twitter:site from siteConfig.seo.twitterHandle', () => {
    const seo = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig({ seo: { twitterHandle: '@vibedocs' } }),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.twitterSite).toBe('@vibedocs')
  })
})

describe('resolvePageSeo — noindex / draft', () => {
  it('sets noindex when frontmatter.noindex is true', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { noindex: true } }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.noindex).toBe(true)
  })

  it('sets noindex when frontmatter.draft is true', () => {
    const seo = resolvePageSeo({
      page: page({ frontmatter: { draft: true } }),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.noindex).toBe(true)
  })

  it('defaults noindex to false', () => {
    const seo = resolvePageSeo({
      page: page(),
      siteConfig: siteConfig(),
      baseUrl: 'https://docs.example.com',
    })
    expect(seo.noindex).toBe(false)
  })
})
