import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * End-to-end smoke test for the compiled bin (#73).
 *
 * The dispatcher seam (`main`) is unit-tested in cli-dispatcher.test.ts, but
 * nothing exercised the *published artifact* — `node dist-cli/cli/index.js`.
 * A regression in the shebang, the self-execution guard, or the build:cli
 * tsconfig could silently break `node_modules/.bin/vibedocs` for consumers
 * with every other test still green.
 *
 * We build the artifact in `beforeAll` (mirroring mermaid-bundle.test.ts,
 * which runs a real build before inspecting the dist output) so the test is
 * self-sufficient rather than dependent on prior `npm run build:cli`. The
 * build is a single `tsc` invocation (a few seconds), well under the bumped
 * hook timeout.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const binPath = path.join(repoRoot, 'dist-cli', 'cli', 'index.js')

beforeAll(() => {
  if (!existsSync(binPath)) {
    execSync('npm run build:cli', { cwd: repoRoot, stdio: 'pipe' })
  }
}, 120_000)

describe('compiled CLI bin smoke test (#73)', () => {
  it('runs `node dist-cli/cli/index.js --help` with exit 0 and a usage banner', () => {
    const stdout = execFileSync('node', [binPath, '--help'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    })

    expect(stdout.length).toBeGreaterThan(0)
    expect(stdout).toMatch(/vibedocs build/)
  })
})
