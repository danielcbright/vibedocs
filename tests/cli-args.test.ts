import { describe, it, expect } from 'vitest'
import { parseBuildArgs } from '../src/cli/args.js'

describe('parseBuildArgs', () => {
  it('parses --project and --out (required pair)', () => {
    const r = parseBuildArgs(['--project', 'argus', '--out', './dist'])
    expect(r.projectName).toBe('argus')
    expect(r.outDir).toBe('./dist')
    expect(r.baseUrl).toBeUndefined()
    expect(r.serve).toBe(false)
    expect(r.port).toBeUndefined()
  })

  it('parses --base-url', () => {
    const r = parseBuildArgs([
      '--project', 'argus',
      '--out', './dist',
      '--base-url', 'https://argus.io',
    ])
    expect(r.baseUrl).toBe('https://argus.io')
  })

  it('parses --serve without --out (serve implies a default out dir if missing)', () => {
    const r = parseBuildArgs(['--project', 'argus', '--serve'])
    expect(r.serve).toBe(true)
    expect(r.projectName).toBe('argus')
  })

  it('parses --port', () => {
    const r = parseBuildArgs(['--project', 'argus', '--serve', '--port', '5001'])
    expect(r.port).toBe(5001)
  })

  it('parses --frontend-dist override', () => {
    const r = parseBuildArgs([
      '--project', 'argus',
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
