import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
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

  it('contains bin/ entry', () => {
    const output = packDryRun()
    expect(output).toMatch(/bin\//)
  })
})
