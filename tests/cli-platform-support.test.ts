import { describe, it, expect } from 'vitest'
import { unsupportedPlatformNotice } from '../src/cli/index.js'

// The supported-platform list is a support policy, and the CI matrix in
// .github/workflows/ci.yml is what backs it. These tests pin the two halves
// together: if someone adds a platform here without adding it to the matrix,
// the claim outruns the evidence.
describe('unsupportedPlatformNotice', () => {
  it.each<NodeJS.Platform>(['linux', 'darwin'])('stays silent on %s', (platform) => {
    expect(unsupportedPlatformNotice(platform)).toBeNull()
  })

  it('warns on win32 without refusing to run', () => {
    const notice = unsupportedPlatformNotice('win32')
    expect(notice).not.toBeNull()
    expect(notice).toContain('win32')
    // "May still work" is the point — a gate would have been package.json `os`.
    expect(notice).toContain('may still work')
    expect(notice).toContain('github.com/danielcbright/vibedocs/issues')
  })

  it('warns on other untested platforms too', () => {
    expect(unsupportedPlatformNotice('freebsd')).toContain('freebsd')
  })
})
