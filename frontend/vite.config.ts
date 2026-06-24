import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

// Emits dist/sw.js from sw-template.js, stamping in a content-derived cache
// version and the real (hashed) app-shell precache list. Build-only — the dev
// server never produces an SW, so live-reload/HMR stay untouched (issue #142).
function vibedocsServiceWorker(): Plugin {
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
  return {
    name: 'vibedocs-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(path.resolve(__dirname, 'sw-template.js'), 'utf-8')

      // Hashed entry/chunk/css filenames make up the app shell and double as
      // the cache-busting version: change any bundled byte → new hash → new
      // cache name → old caches purged on activate.
      const assetPaths = Object.keys(bundle)
        .filter((f) => /\.(js|css)$/.test(f))
        .map((f) => '/' + f)

      const version = createHash('sha256')
        .update(assetPaths.sort().join('|'))
        .digest('hex')
        .slice(0, 12)

      const precache = JSON.stringify([...STATIC_SHELL, ...assetPaths])

      const sw = template
        .replace(/__SW_VERSION__/g, version)
        .replace(/__PRECACHE__/g, precache)

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vibedocsServiceWorker()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../src/shared'),
    },
  },
  optimizeDeps: {
    // Pre-bundle mermaid in dev so the dev-server import shape matches
    // the prod-bundle shape (both go through Rollup-style transformation).
    // Prevents "works in dev, breaks in prod" regressions like the one
    // that motivated this config (issue #23).
    //
    // Note: we deliberately do NOT set `build.rollupOptions.output.manualChunks`
    // to force mermaid into one chunk. An earlier attempt did so to
    // preserve the `default` re-export from `mermaid.core.mjs` (the
    // bug that broke PR #22). But `manualChunks` made Vite place its
    // own `preloadHelper` inside the mermaid chunk, which made the
    // index chunk statically import the mermaid chunk — completely
    // defeating lazy-loading. Letting Rollup default-chunk mermaid
    // splits it into ~30 sub-modules but keeps the mermaid chunks out
    // of the entry's static graph. The runtime `mod.default ?? mod`
    // guard in `mermaid-shim.ts` handles the default-export shape
    // variations across Vite/Rollup versions. See issue #23 and the
    // long-form comment in `mermaid-shim.ts`.
    include: ['mermaid'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    ws: true,
  },
})
