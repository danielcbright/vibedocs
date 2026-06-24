import { describe, it, expect } from 'vitest'
import {
  buildManifest,
  PWA_ICON_FILES,
  renderPwaHeadTags,
  staticServiceWorkerSource,
  swRegisterScriptSource,
} from '../src/cli/pwa.js'
import type { SiteConfig } from '../src/shared/site-config-types.js'

const siteConfig = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  name: 'My Docs',
  domain: 'example.com',
  description: 'Lovely docs.',
  theme: { tokens: {} },
  llms: { summary: 's', keyDocs: [] },
  ...overrides,
})

describe('buildManifest', () => {
  it('defaults name/short_name/description from the project name when no siteConfig', () => {
    const m = buildManifest(null, 'cirrus-weather')
    expect(m.name).toBe('cirrus-weather')
    expect(m.short_name).toBe('cirrus-weather')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
  })

  it('derives name/short_name/description from siteConfig when present', () => {
    const m = buildManifest(siteConfig(), 'fallback')
    expect(m.name).toBe('My Docs')
    expect(m.short_name).toBe('My Docs')
    expect(m.description).toBe('Lovely docs.')
  })

  it('derives theme_color from siteConfig.theme.tokens["--primary"] when set', () => {
    const m = buildManifest(
      siteConfig({ theme: { tokens: { '--primary': '#0ea5e9' } } }),
      'x',
    )
    expect(m.theme_color).toBe('#0ea5e9')
  })

  it('falls back to a sane default theme_color when no token is configured', () => {
    const m = buildManifest(siteConfig(), 'x')
    expect(m.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('references the shared #142 icon set (192, 512, maskable)', () => {
    const m = buildManifest(null, 'x')
    const srcs = m.icons.map((i) => i.src)
    expect(srcs).toContain('/icon-192.png')
    expect(srcs).toContain('/icon-512.png')
    expect(srcs).toContain('/icon-maskable-512.png')
    const maskable = m.icons.find((i) => i.purpose === 'maskable')
    expect(maskable).toBeTruthy()
  })

  it('serialises to valid JSON', () => {
    const m = buildManifest(siteConfig(), 'x')
    expect(() => JSON.parse(JSON.stringify(m))).not.toThrow()
  })
})

describe('PWA_ICON_FILES', () => {
  it('lists the icon/favicon files to copy from the frontend bundle', () => {
    expect(PWA_ICON_FILES).toContain('icon-192.png')
    expect(PWA_ICON_FILES).toContain('icon-512.png')
    expect(PWA_ICON_FILES).toContain('icon-maskable-512.png')
    expect(PWA_ICON_FILES).toContain('apple-touch-icon.png')
    expect(PWA_ICON_FILES).toContain('favicon.svg')
    expect(PWA_ICON_FILES).toContain('favicon.ico')
  })
})

describe('renderPwaHeadTags', () => {
  it('emits a manifest link, theme-color, apple-touch-icon and iOS meta', () => {
    const tags = renderPwaHeadTags({ themeColor: '#0ea5e9', appTitle: 'My Docs' })
    expect(tags).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(tags).toContain('name="theme-color"')
    expect(tags).toContain('#0ea5e9')
    expect(tags).toContain('rel="apple-touch-icon"')
    expect(tags).toContain('apple-mobile-web-app-capable')
    expect(tags).toContain('apple-mobile-web-app-title')
  })

  it('escapes the app title in the iOS meta', () => {
    const tags = renderPwaHeadTags({ themeColor: '#000000', appTitle: 'A & <b>' })
    expect(tags).not.toContain('<b>')
    expect(tags).toContain('A &amp; &lt;b&gt;')
  })
})

describe('staticServiceWorkerSource', () => {
  it('is self-contained JS that precaches the shell and caches navigations', () => {
    const sw = staticServiceWorkerSource('abc123')
    expect(sw).toContain('abc123')
    // No SPA dependency / no /api routing — static sites have no API.
    expect(sw).not.toContain('/api/')
    // Lifecycle + fetch handling present.
    expect(sw).toContain("addEventListener('install'")
    expect(sw).toContain("addEventListener('activate'")
    expect(sw).toContain("addEventListener('fetch'")
    // Precaches the manifest + an icon so the app is installable offline.
    expect(sw).toContain('/manifest.webmanifest')
    expect(sw).toContain('/icon-192.png')
  })

  it('embeds a version-stamped cache name so a rebuild purges stale caches', () => {
    const a = staticServiceWorkerSource('v-one')
    const b = staticServiceWorkerSource('v-two')
    expect(a).toContain('v-one')
    expect(b).toContain('v-two')
    expect(a).not.toBe(b)
  })
})

describe('swRegisterScriptSource', () => {
  it('registers /sw.js and is plain (non-module) so it works in minimal mode', () => {
    const src = swRegisterScriptSource()
    expect(src).toContain('serviceWorker')
    expect(src).toContain('/sw.js')
    expect(src).toContain('register')
  })
})
