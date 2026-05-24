import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

  beforeAll(async () => {
    // Build the frontend into a throwaway dir so this test never collides
    // with `npm run build`. Output goes under `.scratch/` (gitignored).
    await runViteBuild()
    assetsDir = path.join(outDir, 'assets')
    indexChunkPath = await findChunk(assetsDir, 'index-')
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

  it('the mermaid shim resolves at runtime to a usable mermaid API', async () => {
    // Belt-and-braces: actually load the emitted mermaid chunk and walk
    // every named export, confirming at least one is the real mermaid
    // object (has the runtime methods the loader calls). If a future
    // bundling change strips the mermaid object out of the chunk
    // entirely, this fails before reaching a browser.
    //
    // Mermaid's chunk has an `accessibility` side-effect that calls into
    // a `style` property at module-evaluation time — without a DOM-like
    // environment the import throws synchronously. Mock the bits the
    // module touches at top-level so the import succeeds in node.
    type StyleStub = { setProperty: () => void }
    type DocStub = { documentElement?: { style: StyleStub }; body?: { style: StyleStub } }
    const g = globalThis as unknown as { document?: DocStub; window?: { addEventListener: () => void } }
    const hadDoc = 'document' in g
    const hadWin = 'window' in g
    if (!hadDoc) {
      const stubStyle = { setProperty: () => {} }
      g.document = {
        documentElement: { style: stubStyle },
        body: { style: stubStyle },
      }
    }
    if (!hadWin) g.window = { addEventListener: () => {} }

    try {
      const mermaidChunkPath = await findChunk(assetsDir, 'mermaid-')
      const mod = await import(pathToFileURL(mermaidChunkPath).href)
      const candidates = Object.values(mod).filter(
        (v): v is Record<string, unknown> =>
          typeof v === 'object' && v !== null,
      )
      const apiObj = candidates.find(
        (v) =>
          typeof v.initialize === 'function' &&
          typeof v.render === 'function',
      )
      expect(apiObj).toBeDefined()
    } finally {
      if (!hadDoc) delete g.document
      if (!hadWin) delete g.window
    }
  })
})
