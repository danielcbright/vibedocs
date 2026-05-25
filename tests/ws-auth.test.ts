import { describe, it, expect } from 'vitest'
import {
  parseAllowedOrigins,
  isOriginAllowed,
  buildVerifyClient,
} from '../src/ws-auth.js'

describe('parseAllowedOrigins', () => {
  it('returns default localhost origins (port 8080 + Vite dev 5173) when env is unset', () => {
    const got = parseAllowedOrigins({ envValue: undefined, port: 8080 })
    expect(got).toEqual(
      expect.arrayContaining([
        'http://localhost:8080',
        'http://localhost:5173',
      ]),
    )
  })

  it('adds http://localhost:${port} when port differs from 8080', () => {
    const got = parseAllowedOrigins({ envValue: undefined, port: 9999 })
    expect(got).toEqual(
      expect.arrayContaining([
        'http://localhost:9999',
        'http://localhost:8080',
        'http://localhost:5173',
      ]),
    )
  })

  it('parses comma-separated env values', () => {
    const got = parseAllowedOrigins({
      envValue: 'https://docs.example.com,http://other.example:8080',
      port: 8080,
    })
    expect(got).toEqual(
      expect.arrayContaining([
        'https://docs.example.com',
        'http://other.example:8080',
        // defaults still included alongside env entries
        'http://localhost:8080',
        'http://localhost:5173',
      ]),
    )
  })

  it('trims whitespace and ignores empty entries', () => {
    const got = parseAllowedOrigins({
      envValue: '  https://a.example , , https://b.example  ,',
      port: 8080,
    })
    expect(got).toContain('https://a.example')
    expect(got).toContain('https://b.example')
    expect(got).not.toContain('')
    expect(got).not.toContain(' ')
  })

  it('deduplicates entries', () => {
    const got = parseAllowedOrigins({
      envValue: 'http://localhost:8080,http://localhost:8080',
      port: 8080,
    })
    const occurrences = got.filter((o) => o === 'http://localhost:8080').length
    expect(occurrences).toBe(1)
  })
})

describe('isOriginAllowed', () => {
  const allowlist = ['http://localhost:8080', 'https://docs.example.com']

  it('allows an exact match from the allowlist', () => {
    expect(
      isOriginAllowed('http://localhost:8080', allowlist, { allowNoOrigin: false }),
    ).toBe(true)
  })

  it('rejects an origin that is not in the allowlist', () => {
    expect(
      isOriginAllowed('http://evil.example', allowlist, { allowNoOrigin: false }),
    ).toBe(false)
  })

  it('rejects empty/undefined origin by default (no-origin policy = deny)', () => {
    expect(isOriginAllowed(undefined, allowlist, { allowNoOrigin: false })).toBe(false)
    expect(isOriginAllowed('', allowlist, { allowNoOrigin: false })).toBe(false)
  })

  it('allows empty/undefined origin when allowNoOrigin=true', () => {
    expect(isOriginAllowed(undefined, allowlist, { allowNoOrigin: true })).toBe(true)
    expect(isOriginAllowed('', allowlist, { allowNoOrigin: true })).toBe(true)
  })

  it('is case-insensitive on scheme + host but treats them as equivalent', () => {
    // Browsers normally send lowercase, but be defensive.
    expect(
      isOriginAllowed('HTTP://LOCALHOST:8080', allowlist, { allowNoOrigin: false }),
    ).toBe(true)
  })
})

describe('buildVerifyClient', () => {
  it('returns a function that accepts requests with an allowed origin', () => {
    const verify = buildVerifyClient({
      allowedOrigins: ['http://localhost:8080'],
      allowNoOrigin: false,
    })
    const result = verify({
      origin: 'http://localhost:8080',
      secure: false,
      req: {} as any,
    })
    expect(result).toBe(true)
  })

  it('returns a function that rejects requests with a disallowed origin', () => {
    const verify = buildVerifyClient({
      allowedOrigins: ['http://localhost:8080'],
      allowNoOrigin: false,
    })
    const result = verify({
      origin: 'http://evil.example',
      secure: false,
      req: {} as any,
    })
    expect(result).toBe(false)
  })

  it('respects allowNoOrigin when origin is missing', () => {
    const verifyDeny = buildVerifyClient({
      allowedOrigins: ['http://localhost:8080'],
      allowNoOrigin: false,
    })
    // ws sets origin to '' when the header is absent
    expect(verifyDeny({ origin: '', secure: false, req: {} as any })).toBe(false)

    const verifyAllow = buildVerifyClient({
      allowedOrigins: ['http://localhost:8080'],
      allowNoOrigin: true,
    })
    expect(verifyAllow({ origin: '', secure: false, req: {} as any })).toBe(true)
  })
})
