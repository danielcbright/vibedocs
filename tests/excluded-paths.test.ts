import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { EXCLUDED_DIRS } from '../src/excluded-paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '..', 'src')

describe('excluded-paths SSOT module', () => {
  it('exports EXCLUDED_DIRS as a Set with the canonical entries', () => {
    expect(EXCLUDED_DIRS).toBeInstanceOf(Set)
    // The canonical policy set — discovery, search, and path-resolver all share this.
    const expected = [
      'node_modules', '.git', '.next', 'dist', 'build', 'out',
      'coverage', 'tmp', 'temp', '_archived',
      '.project-template', 'test-projects',
    ]
    for (const entry of expected) {
      expect(EXCLUDED_DIRS.has(entry)).toBe(true)
    }
    expect(EXCLUDED_DIRS.size).toBe(expected.length)
  })
})

describe('no consumer redefines EXCLUDED_DIRS locally', () => {
  // The three layers (discovery, search, path-resolver) must import the policy
  // from src/excluded-paths.ts. Re-defining `new Set([...])` locally would
  // silently desynchronise the layers — the exact coupling bug #82 fixes.
  const consumerFiles = ['discovery.ts', 'search.ts', 'path-resolver.ts']

  for (const file of consumerFiles) {
    it(`src/${file} does not contain a local 'new Set(' literal for EXCLUDED_DIRS`, async () => {
      const source = await readFile(path.join(srcDir, file), 'utf-8')
      // Heuristic: any line that both declares EXCLUDED_DIRS and constructs a
      // new Set in the same statement is a redefinition. The SSOT module is
      // the only place that should match.
      const localDefRe = /EXCLUDED_DIRS\s*[:=][^=]*?new Set\s*\(/s
      expect(source).not.toMatch(localDefRe)
    })

    it(`src/${file} imports EXCLUDED_DIRS from the SSOT module`, async () => {
      const source = await readFile(path.join(srcDir, file), 'utf-8')
      expect(source).toMatch(/from\s+['"]\.\/excluded-paths\.js['"]/)
    })
  }
})
