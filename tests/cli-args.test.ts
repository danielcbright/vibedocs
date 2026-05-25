import { describe, it, expect } from 'vitest'
import { parseBuildArgs } from '../src/cli/args.js'

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
      '--base-url', 'https://example.io',
    ])
    expect(r.baseUrl).toBe('https://example.io')
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
})
