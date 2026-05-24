import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The mermaid-bundle regression test runs an actual `vite build`
    // (~17s) inside `beforeAll`. The default 5s test timeout is too
    // tight for that, and a few unrelated tests (eg the Shiki-backed
    // markdown-scroll-wrap suite) get squeezed under parallel load.
    // Bumping to 30s leaves headroom without masking real hangs.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
})
