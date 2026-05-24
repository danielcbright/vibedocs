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
  build: {
    rollupOptions: {
      output: {
        /**
         * Keep mermaid (~1MB) in a single named chunk.
         *
         * Why: mermaid's package entry `dist/mermaid.core.mjs` ends with
         * `export { mermaid_default as default }`. When Rollup's default
         * chunking splits this module across multiple generated chunks,
         * the literal `default` re-export gets dropped from the chunk
         * boundary (only the 130+ named internal exports survive), so a
         * runtime `(await import('mermaid')).default` resolves to
         * `undefined` and every diagram silently fails to render — see
         * issue #23 and the reverted PR #22.
         *
         * Pinning mermaid to one chunk preserves the default re-export.
         * The chunk is still lazy-loaded — `doc-content.tsx` only does
         * `import('mermaid')` when the current document contains at
         * least one `.mermaid` div, so docs without diagrams pay no
         * mermaid bundle cost on first load.
         */
        manualChunks: (id: string) => {
          if (id.includes('node_modules/mermaid/')) return 'mermaid'
          return undefined
        },
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle mermaid in dev so the dev-server import shape matches
    // the prod-bundle shape (both go through Rollup-style transformation).
    // Prevents "works in dev, breaks in prod" regressions like the one
    // that motivated this manualChunks config.
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
    // Proxy WebSocket connections
    ws: true,
  },
})
