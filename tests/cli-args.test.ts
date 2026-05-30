import { describe, it, expect } from 'vitest'
import { parseBuildArgs, resolveHydration } from '../src/cli/args.js'

describe('parseBuildArgs', () => {
  it('parses --project and --out (required pair)', () => {
    const r = parseBuildArgs(['--project', 'demo', '--out', './dist'])
    expect(r.projectName).toBe('demo')
    expect(r.outDir).toBe('./dist')
    expect(r.baseUrl).toBeUndefined()
    expect(r.serve).toBe(false)
    expect(r.port).toBeUndefined()
  })

  it('parses --base-url', () => {
    const r = parseBuildArgs([
      '--project', 'demo',
      '--out', './dist',
      '--base-url', 'https://example.com',
    ])
    expect(r.baseUrl).toBe('https://example.com')
  })

  it('parses --serve without --out (serve implies a default out dir if missing)', () => {
    const r = parseBuildArgs(['--project', 'demo', '--serve'])
    expect(r.serve).toBe(true)
    expect(r.projectName).toBe('demo')
  })

  it('parses --port', () => {
    const r = parseBuildArgs(['--project', 'demo', '--serve', '--port', '5001'])
    expect(r.port).toBe(5001)
  })

  it('parses --frontend-dist override', () => {
    const r = parseBuildArgs([
      '--project', 'demo',
      '--out', './dist',
      '--frontend-dist', '/some/path',
    ])
    expect(r.frontendDist).toBe('/some/path')
  })

  it('throws when --project is missing', () => {
    expect(() => parseBuildArgs(['--out', './dist'])).toThrow(/--project/)
  })

  it('throws when --port is not numeric', () => {
    expect(() =>
      parseBuildArgs(['--project', 'a', '--serve', '--port', 'eighty']),
    ).toThrow(/--port/)
  })

  it('throws on unknown flag', () => {
    expect(() =>
      parseBuildArgs(['--project', 'a', '--out', 'd', '--what']),
    ).toThrow(/unknown/i)
  })

  it('parses --verbose flag', () => {
    const r = parseBuildArgs(['--project', 'demo', '--out', './dist', '--verbose'])
    expect(r.verbose).toBe(true)
  })

  it('verbose defaults to false when not supplied', () => {
    const r = parseBuildArgs(['--project', 'demo', '--out', './dist'])
    expect(r.verbose).toBe(false)
  })

  it('parses --hydration full and --hydration minimal (#76)', () => {
    const full = parseBuildArgs(['--project', 'a', '--out', 'd', '--hydration', 'full'])
    expect(full.hydration).toBe('full')

    const minimal = parseBuildArgs(['--project', 'a', '--out', 'd', '--hydration', 'minimal'])
    expect(minimal.hydration).toBe('minimal')
  })

  it('hydration is undefined when --hydration is not supplied (so the build resolver can fall through to siteConfig / default) (#76)', () => {
    const r = parseBuildArgs(['--project', 'a', '--out', 'd'])
    expect(r.hydration).toBeUndefined()
  })

  it('rejects --hydration with an invalid value (#76)', () => {
    expect(() =>
      parseBuildArgs(['--project', 'a', '--out', 'd', '--hydration', 'progressive']),
    ).toThrow(/--hydration.*full.*minimal/i)
  })
})

describe('resolveHydration — precedence (#76)', () => {
  it('CLI flag overrides siteConfig.hydration when both are set', () => {
    expect(resolveHydration('minimal', 'full')).toBe('minimal')
    expect(resolveHydration('full', 'minimal')).toBe('full')
  })

  it('falls back to siteConfig.hydration when CLI flag is absent', () => {
    expect(resolveHydration(undefined, 'minimal')).toBe('minimal')
    expect(resolveHydration(undefined, 'full')).toBe('full')
  })

  it('defaults to "full" when neither is set (back-compat)', () => {
    expect(resolveHydration(undefined, undefined)).toBe('full')
  })
})
