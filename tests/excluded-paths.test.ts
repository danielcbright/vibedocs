import { describe, it, expect } from 'vitest'
import { EXCLUDED_DIRS } from '../src/excluded-paths.js'

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
