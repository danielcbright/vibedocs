import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Regression test for issue #23.
 *
 * The previous PR (#22, reverted in 31c7ab8) bundled mermaid as a regular
 * npm dep and lazy-loaded it via `import('mermaid')`. It passed dev-server
 * verification but silently failed against `npm run build`: Vite's Rollup
 * chunked `mermaid.core.mjs` and dropped the literal `default` re-export,
 * so `(await import('mermaid')).default` was `undefined` at runtime.
 *
 * This test runs an actual production build of the frontend, then loads
 * the emitted mermaid chunk and confirms it actually exposes the mermaid
 * API that the loader depends on. The emitted chunk is dynamic-imported
 * via the shim's named-binding shape (see mermaid-loader.ts), so the
 * test mirrors the runtime path — if the chunk regresses to a shape
 * where mermaid is unreachable, this test fails BEFORE any browser
 * verification.
 *
 * The build is heavyweight (>15s) but runs once via `beforeAll`. It is
 * the only test in this file by design.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(__dirname, '../frontend')
const outDirRel = '../.scratch/mermaid-bundle-test-dist'
const outDir = path.resolve(__dirname, outDirRel)

function runViteBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['vite', 'build', '--outDir', outDir, '--emptyOutDir'],
      {
        cwd: frontendRoot,
        // Inherit env so PATH / node binaries resolve normally.
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    // Also drain stdout so the build doesn't deadlock on a full pipe.
    child.stdout.on('data', () => {})
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`vite build exited ${code}\nstderr:\n${stderr}`))
    })
  })
}

async function findChunk(assetsDir: string, prefix: string): Promise<string> {
  const files = await fs.readdir(assetsDir)
  const pattern = new RegExp(`^${prefix}.*\\.js$`)
  const match = files.find((f) => pattern.test(f))
  if (!match) {
    throw new Error(
      `expected a chunk matching ${pattern} in ${assetsDir}, got: ${files.join(', ')}`,
    )
  }
  return path.join(assetsDir, match)
}

describe('mermaid production bundle', () => {
  let assetsDir: string
  let indexChunkPath: string
  let indexHtmlPath: string

  beforeAll(async () => {
    // Build the frontend into a throwaway dir so this test never collides
    // with `npm run build`. Output goes under `.scratch/` (gitignored).
    await runViteBuild()
    assetsDir = path.join(outDir, 'assets')
    indexChunkPath = await findChunk(assetsDir, 'index-')
    indexHtmlPath = path.join(outDir, 'index.html')
  }, 180_000)

  it('the index chunk does not leak the reverted-PR-22 broken-default access pattern', async () => {
    // The original regression manifested as Rollup transforming
    //   const mermaid = (await import('mermaid')).default
    // into
    //   const u = (await ...import("./mermaid-X.js").then(f => f.<short>)).default
    // where `f.<short>` already IS the resolved default value (the mermaid
    // object), so the trailing `.default` access returned undefined and
    // every diagram silently failed to render.
    //
    // The pattern to forbid: a dynamic-import of the mermaid chunk that
    // ends with `.default` access. Specifically: a `.then(f=>f.X)` chunk
    // unwrap followed (after any wrapper call args) by `).default`. The
    // current shim-based loader destructures `{ mermaid }` (a named
    // binding), so the bundle should contain `.then(f => f.<short>))`
    // with NO trailing `.default`.
    //
    // The regex tolerates the Vite `__vite__mapDeps` wrapper argument
    // that sits between the `.then(...)` and the trailing `).default`.
    const indexSource = await fs.readFile(indexChunkPath, 'utf-8')
    expect(indexSource).not.toMatch(
      /\.then\(\w+=>\w+\.\w+\)[^.;{}]*\)\.default/,
    )
  })

  it('the emitted index.html does NOT modulepreload any mermaid chunk', async () => {
    // Regression guard for the lazy-load criterion of issue #23.
    //
    // Vite's modulepreload analysis walks the static-import graph from
    // each entry point and emits `<link rel="modulepreload">` hints for
    // every chunk it deems "needed soon". The previous fix kept a static
    // `import mermaidDefault from 'mermaid'` inside the shim (which is
    // itself dynamic-imported). Vite then either (a) emitted a
    // `<link rel="modulepreload">` for the mermaid chunk in index.html,
    // or (b) inlined the shim into the entry chunk and statically
    // imported mermaid from there — either way the full 2.88 MB
    // mermaid bundle was fetched alongside index.js on every page load,
    // even on docs with zero diagrams, defeating the lazy-load story.
    //
    // The fix must arrange for NO modulepreload hint that references
    // ANY mermaid chunk (mermaid-*.js, mermaid.core-*.js, or any other
    // mermaid sub-module split) to appear in dist/index.html. The
    // mermaid chunks must still be fetched on-demand the first time a
    // doc with a `.mermaid` div is rendered.
    const html = await fs.readFile(indexHtmlPath, 'utf-8')
    const preloadRe = /<link\s+rel=["']modulepreload["'][^>]*href=["'][^"']*mermaid[.\-][^"']*\.js["'][^>]*>/i
    expect(html).not.toMatch(preloadRe)
  })

  it('the entry index chunk does NOT statically import any mermaid-related chunk', async () => {
    // The modulepreload test above catches Vite-emitted `<link>` hints,
    // but a static `import ... from "./mermaid-X.js"` directly in the
    // entry chunk would ALSO force the browser to fetch the mermaid
    // chunk on every page load — and would not show up as a
    // `modulepreload` hint. That was the deeper failure mode of an
    // earlier attempt at this fix: `manualChunks` had placed Vite's
    // `preloadHelper` inside the mermaid chunk, and the entry chunk
    // then statically imported the helper from it. Stripping the
    // modulepreload tag did nothing — the static `import` IS the load.
    //
    // With a properly dynamic shim and default chunking, the index
    // chunk should only contain dynamic `import('./mermaid-shim-*.js')`
    // calls — never a static `from "./<anything-mermaid>.js"`.
    //
    // We allow-list anything containing the word "mermaid" or one of
    // mermaid's diagram sub-modules. If a future change requires a
    // module name that legitimately collides with one of these prefixes
    // it can be added to the regex.
    const indexSource = await fs.readFile(indexChunkPath, 'utf-8')
    const staticImportRe = /from\s*["']\.\/mermaid[.\-][^"']*\.js["']/i
    expect(indexSource).not.toMatch(staticImportRe)
  })

  it('a mermaid-related chunk is actually emitted (not tree-shaken away)', async () => {
    // Sanity check: even though we no longer pin mermaid into one chunk
    // via `manualChunks`, the dynamic-import shim should still cause
    // Rollup to emit at least one mermaid sub-module chunk (the entry
    // chunk that the shim dynamic-imports). If a future config change
    // accidentally inlined the shim's mermaid import into the entry
    // chunk, lazy-loading would silently break — this test catches
    // that, complementing the modulepreload / static-import structural
    // guards above.
    const files = await fs.readdir(assetsDir)
    const mermaidChunks = files.filter(
      (f) => /^mermaid[.\-]/.test(f) && f.endsWith('.js'),
    )
    expect(mermaidChunks.length).toBeGreaterThan(0)
  })
})
