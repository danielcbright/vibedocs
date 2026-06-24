// VibeDocs service worker (issue #142). PRODUCTION ONLY — see the registration
// guard in src/lib/register-sw.ts (it never registers under `npm run dev`, so
// the live-reload WebSocket is untouched in development).
//
// This file is a TEMPLATE. The Vite build plugin (vibedocsServiceWorker in
// frontend/vite.config.ts) substitutes the VERSION and PRECACHE placeholders
// below at build time and emits the result as dist/sw.js. The routing rules
// here mirror src/lib/sw-strategy.ts (which has the unit tests) — keep in sync.

const VERSION = '__SW_VERSION__'
const CACHE = 'vibedocs-' + VERSION
// App shell: index.html + hashed asset bundle + icons/manifest. Stamped at build.
const PRECACHE = __PRECACHE__

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
            .filter((name) => name.startsWith('vibedocs-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function chooseStrategy(req, url) {
  if (req.method !== 'GET') return 'network-only'
  if (url.origin !== self.location.origin) return 'network-only'
  const p = url.pathname
  if (p.startsWith('/assets/')) return 'cache-first'
  if (p.startsWith('/api/render/') || p.startsWith('/api/raw/')) return 'network-first'
  if (p === '/api/projects' || p.startsWith('/api/projects?')) return 'network-first'
  if (p.startsWith('/api/')) return 'network-only'
  return 'network-first' // navigations + app shell
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    const cached = await cache.match(req)
    if (cached) return cached
    // Navigation offline with no cached entry → fall back to the app shell.
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html')
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
  const url = new URL(event.request.url)
  const strategy = chooseStrategy(event.request, url)
  if (strategy === 'network-only') return // default browser handling
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event.request))
  } else {
    event.respondWith(networkFirst(event.request))
  }
})

// Let the page trigger an immediate update (used by the update toast, if any).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
