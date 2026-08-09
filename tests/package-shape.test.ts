import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function packDryRun(): string {
  return execSync('npm pack --dry-run --ignore-scripts 2>&1', {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
}

describe('npm pack --dry-run package shape (#75)', () => {
  it('contains no .ts source files', () => {
    const output = packDryRun()
    const lines = output.split('\n').filter((l) => l.includes('.ts') && !l.includes('.tsx'))
    expect(lines, 'expected no .ts files in packed tarball').toHaveLength(0)
  })

  it('contains no tsconfig*.json files', () => {
    const output = packDryRun()
    const lines = output.split('\n').filter((l) => /tsconfig.*\.json/.test(l))
    expect(lines, 'expected no tsconfig files in packed tarball').toHaveLength(0)
  })

  it('contains no CLAUDE.md', () => {
    const output = packDryRun()
    const lines = output.split('\n').filter((l) => l.includes('CLAUDE.md'))
    expect(lines, 'expected CLAUDE.md not in packed tarball').toHaveLength(0)
  })

  it('contains dist-cli/cli/index.js', () => {
    const output = packDryRun()
    expect(output).toMatch(/dist-cli\/cli\/index\.js/)
  })

  it('contains frontend/dist/index.html', () => {
    const output = packDryRun()
    expect(output).toMatch(/frontend\/dist\/index\.html/)
  })

  it('contains LICENSE and README.md', () => {
    const output = packDryRun()
    expect(output).toMatch(/LICENSE/)
    expect(output).toMatch(/README\.md/)
  })

  // `bin/vibedocs` is the DEV entrypoint: it re-execs node with tsx to load
  // `src/cli/index.ts`. `src/` is deliberately not packed, so shipping this
  // file put a guaranteed ERR_MODULE_NOT_FOUND in the tarball — dead weight
  // that only ever misleads. Consumers reach the CLI through the `bin` field,
  // which points at the compiled `dist-cli/cli/index.js` (asserted above).
  it('does not ship the dev bin/ shim, which references unpacked src/', () => {
    const output = packDryRun()
    expect(output).not.toMatch(/\bbin\/vibedocs\b/)
  })

  it('declares the CLI through the compiled bin entry', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
    ) as { bin: Record<string, string> }
    expect(pkg.bin.vibedocs).toBe('./dist-cli/cli/index.js')
    expect(packDryRun()).toMatch(/dist-cli\/cli\/index\.js/)
  })
})
