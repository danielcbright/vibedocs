// PWA emission for `vibedocs build` (issue #143). Pure, unit-testable pieces:
// the manifest builder, the `<head>` PWA tags, the self-contained static
// service worker source, and its registration script. `runBuild`
// (src/cli/build.ts) copies the shared #142 icon set into the output and
// writes the manifest + SW emitted here; `composePageHtml` (src/cli/template.ts)
// injects the head tags in BOTH hydration branches.
//
// Why a separate static SW (vs reusing frontend/sw-template.js): the live-app
// SW routes `/api/render/...` etc. A static build has no API — pages are
// plain HTML at clean URLs. So this SW is simpler: precache the shell
// (manifest + icons), then network-first for navigations (cache each visited
// page for offline reading) and cache-first for hashed `/assets/`. It is
// fully self-contained — it must work in `minimal` mode where it is the ONLY
// JavaScript shipped.

import { escapeAttr } from './template.js'
import type { SiteConfig } from '../shared/site-config-types.js'

/** Default accent — matches the #142 live-app manifest theme_color. */
const DEFAULT_THEME_COLOR = '#8852e0'
const DEFAULT_BACKGROUND_COLOR = '#020817'

export interface WebManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: 'any' | 'maskable'
}

export interface WebManifest {
  name: string
  short_name: string
  description: string
  id: string
  start_url: string
  scope: string
  display: 'standalone'
  orientation: 'any'
  theme_color: string
  background_color: string
  icons: WebManifestIcon[]
}

/**
 * Icon/favicon files copied from the built frontend bundle (Vite mirrors
 * `frontend/public/*` into `frontend/dist/`) into the static output root.
 * Single source of truth so build.ts and tests agree. These are the #142
 * assets — we do NOT regenerate them.
 */
export const PWA_ICON_FILES: readonly string[] = [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
  'favicon.ico',
  'favicon-dark.png',
  'favicon-light.png',
]

/** Standard #142 icon set, referenced from the manifest. */
const MANIFEST_ICONS: WebManifestIcon[] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/**
 * Build the web app manifest for a static build. Derives display fields from
 * `siteConfig` where sensible, defaulting cleanly when it's absent:
 *
 *  - name / short_name / description ← siteConfig (else the project name)
 *  - theme_color                     ← siteConfig.theme.tokens['--primary']
 *                                       (else the #142 default accent)
 */
export function buildManifest(
  siteConfig: SiteConfig | null,
  projectName: string,
): WebManifest {
  const name = siteConfig?.name?.trim() || projectName
  const description = siteConfig?.description?.trim() || `${projectName} documentation`
  const themeColor = resolveThemeColor(siteConfig)
  return {
    name,
    short_name: name,
    description,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: themeColor,
    background_color: DEFAULT_BACKGROUND_COLOR,
    icons: MANIFEST_ICONS,
  }
}

/** Brand accent for the manifest + theme-color meta. */
export function resolveThemeColor(siteConfig: SiteConfig | null): string {
  const token = siteConfig?.theme?.tokens?.['--primary']?.trim()
  // Only honour a token that's already a hex color — Tailwind theme tokens can
  // be `oklch(...)` or bare HSL triples that aren't valid as a `theme_color`.
  if (token && /^#[0-9a-fA-F]{3,8}$/.test(token)) return token
  return DEFAULT_THEME_COLOR
}

export interface PwaHeadOptions {
  themeColor: string
  /** Installed-app / home-screen title (iOS reads this, not the manifest). */
  appTitle: string
}

/**
 * The PWA `<head>` tags injected into every generated page (both hydration
 * modes): manifest link, theme-color, favicons, and the iOS "Add to Home
 * Screen" meta that iOS Safari reads instead of the manifest.
 */
export function renderPwaHeadTags(opts: PwaHeadOptions): string {
  const themeColor = escapeAttr(opts.themeColor)
  const title = escapeAttr(opts.appTitle)
  return [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    `<meta name="theme-color" content="${themeColor}" />`,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    '<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="/favicon-dark.png" />',
    '<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="/favicon-light.png" />',
    '<link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="any" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<meta name="apple-mobile-web-app-title" content="${title}" />`,
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  ].join('\n    ')
}

/** Static shell precached on SW install — installable + offline from first load. */
const STATIC_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.svg',
  '/favicon.ico',
]

/**
 * Self-contained service worker for static builds. No SPA dependency, no
 * `/api/` routing — works as the only JS in `minimal` mode. Strategy:
 *
 *  - install : precache the shell (root, manifest, icons) so the installed
 *              app opens offline immediately after first visit.
 *  - activate: purge any `vibedocs-static-*` cache that isn't the current
 *              version, so a rebuild doesn't serve stale pages forever.
 *  - fetch   : `/assets/*` (content-hashed, immutable) → cache-first.
 *              Everything else same-origin GET → network-first, caching each
 *              response so visited pages read offline; navigations fall back
 *              to the cached root shell when offline with no cached entry.
 *
 * `version` is stamped into the cache name (content-derived in build.ts).
 */
export function staticServiceWorkerSource(version: string): string {
  const cacheName = `vibedocs-static-${version}`
  const precache = JSON.stringify(STATIC_SHELL)
  return `// Generated by vibedocs build (issue #143) — do not edit.
const CACHE = ${JSON.stringify(cacheName)}
const PRECACHE = ${precache}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('vibedocs-static-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    const cached = await cache.match(req)
    if (cached) return cached
    if (req.mode === 'navigate') {
      const shell = (await cache.match('/index.html')) || (await cache.match('/'))
      if (shell) return shell
    }
    throw err
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
  } else {
    event.respondWith(networkFirst(req))
  }
})
`
}

/**
 * Tiny registration script written to `/sw-register.js` and referenced from
 * every page. Plain (non-module) so it doesn't trip the
 * `not.toContain('<script type="module"')` minimal-mode contract — and so it
 * runs identically whether or not the SPA bundle ships.
 */
export function swRegisterScriptSource(): string {
  return `// Generated by vibedocs build (issue #143).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {})
  })
}
`
}
