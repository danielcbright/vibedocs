import { describe, it, expect } from 'vitest'
import {
  formatSitemap,
  formatRobots,
  normalizeBaseUrl,
  type SitemapPage,
} from '../src/cli/sitemap.js'

describe('normalizeBaseUrl', () => {
  it('prepends https:// to a bare hostname', () => {
    expect(normalizeBaseUrl('example.com')).toBe('https://example.com')
  })

  it('keeps an explicit protocol', () => {
    expect(normalizeBaseUrl('http://example.com')).toBe('http://example.com')
    expect(normalizeBaseUrl('https://docs.example.com')).toBe('https://docs.example.com')
  })

  it('strips a trailing slash', () => {
    expect(normalizeBaseUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeBaseUrl('example.com/')).toBe('https://example.com')
  })
})

describe('formatSitemap', () => {
  it('emits an exact XML document for the given pages', () => {
    const pages: SitemapPage[] = [
      { url: '/', frontmatter: {} },
      { url: '/docs/install/', frontmatter: {} },
    ]
    const xml = formatSitemap({ pages, baseUrl: 'https://example.com' })
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '  <url>\n' +
        '    <loc>https://example.com/</loc>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://example.com/docs/install/</loc>\n' +
        '  </url>\n' +
        '</urlset>\n',
    )
  })

  it('excludes pages with frontmatter noindex: true', () => {
    const pages: SitemapPage[] = [
      { url: '/', frontmatter: {} },
      { url: '/secret/', frontmatter: { noindex: true } },
      { url: '/docs/', frontmatter: { noindex: false } },
    ]
    const xml = formatSitemap({ pages, baseUrl: 'https://example.com' })
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/docs/</loc>')
    expect(xml).not.toContain('/secret/')
  })

  it('normalizes a bare-hostname baseUrl and avoids double slashes', () => {
    const pages: SitemapPage[] = [{ url: '/', frontmatter: {} }]
    const xml = formatSitemap({ pages, baseUrl: 'example.com/' })
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).not.toContain('https://example.com//')
  })

  it('XML-escapes special characters in the URL', () => {
    const pages: SitemapPage[] = [{ url: '/a&b/', frontmatter: {} }]
    const xml = formatSitemap({ pages, baseUrl: 'https://example.com' })
    expect(xml).toContain('<loc>https://example.com/a&amp;b/</loc>')
    expect(xml).not.toContain('/a&b/')
  })
})

describe('formatRobots', () => {
  it('emits a permissive robots.txt referencing the sitemap', () => {
    const txt = formatRobots({ baseUrl: 'https://example.com' })
    expect(txt).toBe(
      'User-agent: *\n' + 'Allow: /\n' + 'Sitemap: https://example.com/sitemap.xml\n',
    )
  })

  it('normalizes a bare-hostname baseUrl', () => {
    const txt = formatRobots({ baseUrl: 'example.com' })
    expect(txt).toContain('Sitemap: https://example.com/sitemap.xml')
  })

  it('honours an explicit sitemapUrl override', () => {
    const txt = formatRobots({
      baseUrl: 'https://example.com',
      sitemapUrl: 'https://cdn.example.com/sitemap.xml',
    })
    expect(txt).toContain('Sitemap: https://cdn.example.com/sitemap.xml')
  })
})
