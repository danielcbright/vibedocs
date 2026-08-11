import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations by design.
import { checkReleaseReadiness } from '../scripts/release-check.mjs'

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/**
 * The state immediately after `npm version patch` on a clean main: the bump is
 * committed, the tag exists and points at HEAD, and neither has been pushed
 * yet. This is the exact moment `release:check` is meant to run.
 */
const READY = {
  version: '0.5.0',
  gitStatusPorcelain: '',
  branch: 'main',
  ahead: 1,
  behind: 0,
  publishedVersions: ['0.3.0', '0.4.0'],
  headSha: HEAD,
  tagSha: HEAD,
}

// The question this answers is precisely: "if I push HEAD and the v<version>
// tag right now, will the release job succeed?" Anything that would not break
// that push is a warning, not a blocker — an over-eager blocker is worse than
// no check, because the fix is to stop running the check.
describe('checkReleaseReadiness — pre-tag guard', () => {
  it('passes the state produced by `npm version` — tag on HEAD, not yet pushed', () => {
    const result = checkReleaseReadiness(READY)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('derives the tag name from the package version', () => {
    expect(checkReleaseReadiness(READY).tag).toBe('v0.5.0')
  })

  // Unpushed commits are the NORMAL state here: `npm version` just made one.
  // Warn so the reader remembers --follow-tags, but never block.
  it('warns rather than blocks on unpushed commits', () => {
    const result = checkReleaseReadiness({ ...READY, ahead: 1 })
    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/follow-tags/)
  })

  it('warns when the tag does not exist yet', () => {
    const result = checkReleaseReadiness({ ...READY, tagSha: null })
    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/no v0\.5\.0 tag/i)
  })

  // The genuinely dangerous case: a tag left over from an earlier attempt that
  // points somewhere other than what you are about to push. CI would check out
  // the tag and build code you are not looking at.
  it('blocks when the tag points at a different commit than HEAD', () => {
    const result = checkReleaseReadiness({ ...READY, tagSha: OTHER })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/does not point at HEAD/i)
  })

  it('blocks on an uncommitted working tree', () => {
    const result = checkReleaseReadiness({ ...READY, gitStatusPorcelain: ' M src/server.ts' })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/clean|uncommitted/i)
  })

  it('blocks when the version is already on the registry', () => {
    const result = checkReleaseReadiness({ ...READY, publishedVersions: ['0.4.0', '0.5.0'] })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/already published/i)
  })

  it('blocks when the branch is behind origin', () => {
    const result = checkReleaseReadiness({ ...READY, behind: 3 })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toMatch(/behind/i)
  })

  it('warns but does not block when releasing off main', () => {
    const result = checkReleaseReadiness({ ...READY, branch: 'hotfix/0.5.1' })
    expect(result.ok).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/main/i)
  })

  it('collects every problem at once', () => {
    const result = checkReleaseReadiness({
      ...READY,
      gitStatusPorcelain: ' M x',
      behind: 2,
      publishedVersions: ['0.5.0'],
    })
    expect(result.problems.length).toBeGreaterThanOrEqual(3)
  })

  // A first-ever release has no published versions at all.
  it('passes when the package has never been published', () => {
    const result = checkReleaseReadiness({ ...READY, publishedVersions: [] })
    expect(result.ok).toBe(true)
  })
})
