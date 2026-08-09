import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations by design.
import { checkReleaseReadiness } from '../scripts/release-check.mjs'

/** A state where cutting v0.5.0 is safe. */
const READY = {
  version: '0.5.0',
  gitStatusPorcelain: '',
  branch: 'main',
  ahead: 0,
  behind: 0,
  existingTags: ['v0.3.0', 'v0.4.0'],
  publishedVersions: ['0.3.0', '0.4.0'],
}

// Releasing is `git push origin v<version>`, after which CI publishes via OIDC
// with no human in the loop. Everything that used to be caught by a human
// pausing mid-ritual has to be caught here instead.
describe('checkReleaseReadiness — pre-tag guard', () => {
  it('passes a clean, pushed, unpublished, untagged state', () => {
    const result = checkReleaseReadiness(READY)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('derives the tag name from the package version', () => {
    expect(checkReleaseReadiness(READY).tag).toBe('v0.5.0')
  })

  // A dirty tree means the tag would point at a commit that does not contain
  // what you just tested locally.
  it('blocks on an uncommitted working tree', () => {
    const result = checkReleaseReadiness({ ...READY, gitStatusPorcelain: ' M src/server.ts' })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/uncommitted|clean/i)
  })

  it('blocks when the version is already on the registry', () => {
    const result = checkReleaseReadiness({ ...READY, publishedVersions: ['0.4.0', '0.5.0'] })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/already published/i)
  })

  it('blocks when the tag already exists', () => {
    const result = checkReleaseReadiness({ ...READY, existingTags: ['v0.4.0', 'v0.5.0'] })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/tag/i)
  })

  // Pushing a tag also pushes the objects it needs, so an unpushed commit would
  // have CI build a commit that is not on main — green CI for code no one
  // reviewed on the branch.
  it('blocks when local commits are not pushed to origin', () => {
    const result = checkReleaseReadiness({ ...READY, ahead: 2 })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/push/i)
  })

  it('blocks when the branch is behind origin', () => {
    const result = checkReleaseReadiness({ ...READY, behind: 3 })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/behind/i)
  })

  // Releasing from a side branch is unusual but legitimate (a hotfix line), so
  // it is surfaced without blocking.
  it('warns but does not block when releasing off main', () => {
    const result = checkReleaseReadiness({ ...READY, branch: 'hotfix/0.5.1' })
    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/main/i)
  })

  it('collects every problem at once', () => {
    const result = checkReleaseReadiness({
      ...READY,
      gitStatusPorcelain: ' M x',
      ahead: 1,
      publishedVersions: ['0.5.0'],
    })
    expect(result.problems.length).toBeGreaterThanOrEqual(3)
  })
})
