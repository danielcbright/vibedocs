// Pure, unit-testable service-worker routing policy. The actual service
// worker (frontend/public/sw.js) is a classic (non-module) worker that can't
// import this at runtime, so it inlines the same rules — but the decision
// table lives here so it has tests. Keep the two in sync; the SW file points
// back to this module.

export type CacheStrategy =
  | 'network-first' // try network, fall back to cache (fresh-when-online docs)
  | 'cache-first' // serve cache, only hit network on miss (immutable hashed assets)
  | 'network-only' // never cache (live-reload WS upgrades, uploads, non-GET)

export interface RequestShape {
  method: string
  /** Same-origin pathname, e.g. "/api/render/foo/bar.md" or "/assets/index-abc.js" */
  pathname: string
  /** True when the browser navigates to a document (Accept: text/html top-level). */
  isNavigation: boolean
  /** True for cross-origin requests — we never cache those. */
  crossOrigin: boolean
}

export function chooseStrategy(req: RequestShape): CacheStrategy {
  if (req.method !== 'GET') return 'network-only'
  if (req.crossOrigin) return 'network-only'

  // Vite emits content-hashed filenames under /assets/ — immutable, cache hard.
  if (req.pathname.startsWith('/assets/')) return 'cache-first'

  // Rendered docs + raw markdown: keep them readable offline, but prefer fresh
  // copies when the network is up (live workspace edits often).
  if (req.pathname.startsWith('/api/render/') || req.pathname.startsWith('/api/raw/')) {
    return 'network-first'
  }

  // The project list and file tree — cache so the sidebar renders offline.
  if (req.pathname === '/api/projects' || req.pathname.startsWith('/api/projects?')) {
    return 'network-first'
  }

  // Anything else under /api/ is dynamic state we shouldn't cache (search,
  // config, uploads). Let it hit the network and fail honestly offline.
  if (req.pathname.startsWith('/api/')) return 'network-only'

  // Top-level navigations and the app shell (index.html, manifest, icons):
  // network-first so a deploy is picked up, cache fallback so the installed
  // app opens with no network.
  if (req.isNavigation) return 'network-first'

  return 'network-first'
}

/** Cache name carries the build version so a new deploy orphans old caches. */
export function cacheName(version: string): string {
  return `vibedocs-${version}`
}

/** True if a cache should be deleted during `activate` (any vibedocs cache not matching the current version). */
export function isStaleCache(name: string, currentVersion: string): boolean {
  return name.startsWith('vibedocs-') && name !== cacheName(currentVersion)
}
