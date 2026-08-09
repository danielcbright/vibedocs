import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs build script, no type declarations by design.
import {
  checkTarballContents,
  REQUIRED_TARBALL_ENTRIES,
  MIN_FRONTEND_ASSETS,
} from '../scripts/tarball-contract.mjs'

/**
 * A tarball listing that satisfies the contract — the shape `tar -tzf` prints.
 */
function goodListing(): string[] {
  return [
    ...REQUIRED_TARBALL_ENTRIES,
    ...Array.from(
      { length: MIN_FRONTEND_ASSETS },
      (_, i) => `package/frontend/dist/assets/chunk-${i}.js`,
    ),
  ]
}

// This contract is the single source of truth for "what a published vibedocs
// tarball must contain". Both the local `npm run pack:inspect` gate and the
// `publish-rehearsal` CI job assert through it, so the two cannot drift — the
// drift that mattered historically was a publish shipping zero frontend assets.
describe('checkTarballContents — published tarball contract', () => {
  it('passes a listing that has every required entry and enough assets', () => {
    const result = checkTarballContents(goodListing())
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each(REQUIRED_TARBALL_ENTRIES)('fails when %s is missing', (missing: string) => {
    const result = checkTarballContents(goodListing().filter((e) => e !== missing))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(missing)
  })

  // The regression that motivates the whole gate: `prepare` not running during
  // pack yields index.html (it is a committed-ish build artifact in some trees)
  // while assets/ is empty. Counting entries is what catches a half-run build.
  it('fails when frontend assets are present but too few', () => {
    const listing = [
      ...REQUIRED_TARBALL_ENTRIES,
      'package/frontend/dist/assets/only-one.js',
    ]
    const result = checkTarballContents(listing)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/asset/i)
  })

  it('fails when the assets directory is entirely absent', () => {
    const result = checkTarballContents([...REQUIRED_TARBALL_ENTRIES])
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/asset/i)
  })

  it('reports every problem at once rather than only the first', () => {
    const result = checkTarballContents(['package/README.md'])
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('does not count nested non-asset paths toward the asset total', () => {
    const listing = [
      ...REQUIRED_TARBALL_ENTRIES,
      ...Array.from({ length: 20 }, (_, i) => `package/frontend/dist/other/f-${i}.js`),
    ]
    expect(checkTarballContents(listing).ok).toBe(false)
  })
})
