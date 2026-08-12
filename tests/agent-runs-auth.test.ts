import { describe, it, expect } from 'vitest'
import { checkBearerToken } from '../src/bearer-auth.js'
import { checkRunsIngestAuth, checkRunsControlAuth } from '../src/agent-runs/auth.js'
import { checkUploadAuth, parseUploadAuthConfig } from '../src/upload-auth.js'

const enabled = { enabled: true, runsDir: '/tmp/runs', token: 's3cret' }

describe('checkBearerToken', () => {
  it('accepts a correct Bearer header, case-insensitively on the scheme', () => {
    expect(checkBearerToken('s3cret', 'Bearer s3cret')).toBe(true)
    expect(checkBearerToken('s3cret', 'bearer s3cret')).toBe(true)
    expect(checkBearerToken('s3cret', '  Bearer   s3cret  ')).toBe(true)
  })

  it('rejects a wrong, missing, malformed or differently-sized token', () => {
    expect(checkBearerToken('s3cret', 'Bearer wrong!')).toBe(false)
    expect(checkBearerToken('s3cret', undefined)).toBe(false)
    expect(checkBearerToken('s3cret', 's3cret')).toBe(false)        // no scheme
    expect(checkBearerToken('s3cret', 'Basic s3cret')).toBe(false)
    expect(checkBearerToken('s3cret', 'Bearer s3cretlonger')).toBe(false)
    expect(checkBearerToken('s3cret', 'Bearer s3c')).toBe(false)
  })
})

describe('upload auth is unchanged by the extraction', () => {
  it('still returns the same four outcomes in the same order', () => {
    const ro = parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'true', VIBEDOCS_UPLOAD_TOKEN: 'tok' })
    expect(checkUploadAuth(ro, 'Bearer tok')).toBe('read-only')
    expect(checkUploadAuth(parseUploadAuthConfig({}), 'Bearer tok')).toBe('no-token-configured')
    const tok = parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: 'tok' })
    expect(checkUploadAuth(tok, 'Bearer nope')).toBe('unauthorized')
    expect(checkUploadAuth(tok, 'Bearer tok')).toBe('ok')
  })
})

describe('checkRunsIngestAuth', () => {
  it('hides the endpoint when the feature is disabled', () => {
    expect(checkRunsIngestAuth({ ...enabled, enabled: false }, 'Bearer s3cret')).toBe('disabled')
  })

  it('hides the endpoint when no token is configured, rather than 401-ing', () => {
    // Same reasoning as uploads: an unauthenticated scanner should not be able
    // to fingerprint the feature.
    expect(checkRunsIngestAuth({ ...enabled, token: null }, undefined)).toBe('no-token-configured')
  })

  it('rejects a wrong token and accepts the right one', () => {
    expect(checkRunsIngestAuth(enabled, 'Bearer nope')).toBe('unauthorized')
    expect(checkRunsIngestAuth(enabled, undefined)).toBe('unauthorized')
    expect(checkRunsIngestAuth(enabled, 'Bearer s3cret')).toBe('ok')
  })

  it('checks disabled before token, so a disabled server never reveals token state', () => {
    expect(checkRunsIngestAuth({ enabled: false, runsDir: '/x', token: null }, undefined)).toBe('disabled')
  })
})

describe('checkRunsControlAuth', () => {
  const allow = ['http://localhost:8080', 'http://127.0.0.1:8080']

  it('accepts a same-origin browser write with no token at all', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'http://localhost:8080', allow)).toBe('ok')
    expect(checkRunsControlAuth({ enabled: true }, 'http://127.0.0.1:8080', allow)).toBe('ok')
  })

  it('rejects a cross-origin write — this is the CSRF boundary', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'https://attacker.example.com', allow)).toBe('forbidden')
  })

  it('rejects a request with no Origin header', () => {
    // A browser always sends Origin on POST/PATCH. Absence means a non-browser
    // client, and those belong on the token path.
    expect(checkRunsControlAuth({ enabled: true }, undefined, allow)).toBe('forbidden')
    expect(checkRunsControlAuth({ enabled: true }, '', allow)).toBe('forbidden')
  })

  it('matches origins case-insensitively', () => {
    expect(checkRunsControlAuth({ enabled: true }, 'HTTP://LOCALHOST:8080', allow)).toBe('ok')
  })

  it('reports disabled before anything else', () => {
    expect(checkRunsControlAuth({ enabled: false }, 'http://localhost:8080', allow)).toBe('disabled')
  })
})
