import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
