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

  it('accepts a machine client presenting only the ingest token', () => {
    // A non-browser client reporting its own lifecycle has no origin to offer
    // and should not have to invent one. It already holds the ingest token, and
    // a client that can append arbitrary events to a run can already fabricate
    // the transcript — so letting it set status is a small increment.
    expect(
      checkRunsControlAuth({
        cfg: { enabled: true, token: 's3cret' },
        origin: undefined,
        allowedOrigins: allow,
        authorization: 'Bearer s3cret',
      }),
    ).toBe('ok')
  })

  it('accepts a request presenting both credentials', () => {
    // Neither door invalidates the other — a client that happens to send both
    // must not be penalised for it.
    expect(
      checkRunsControlAuth({
        cfg: { enabled: true, token: 's3cret' },
        origin: 'http://localhost:8080',
        allowedOrigins: allow,
        authorization: 'Bearer s3cret',
      }),
    ).toBe('ok')
  })

  it('accepts an allowlisted origin even when the token presented is wrong', () => {
    // The browser never sends a token; a stale or bogus Authorization header
    // must not disqualify an otherwise valid same-origin write.
    expect(
      checkRunsControlAuth({
        cfg: { enabled: true, token: 's3cret' },
        origin: 'http://localhost:8080',
        allowedOrigins: allow,
        authorization: 'Bearer wrong',
      }),
    ).toBe('ok')
  })

  it('accepts a same-origin browser write with no token at all', () => {
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: 'http://localhost:8080', allowedOrigins: allow, authorization: undefined })).toBe('ok')
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: 'http://127.0.0.1:8080', allowedOrigins: allow, authorization: undefined })).toBe('ok')
  })

  it('rejects a cross-origin write — this is the CSRF boundary', () => {
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: 'https://attacker.example.com', allowedOrigins: allow, authorization: undefined })).toBe('forbidden')
  })

  it('rejects a request with no Origin header', () => {
    // A browser always sends Origin on POST/PATCH. Absence means a non-browser
    // client, and those belong on the token path.
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: undefined, allowedOrigins: allow, authorization: undefined })).toBe('forbidden')
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: '', allowedOrigins: allow, authorization: undefined })).toBe('forbidden')
  })

  it('matches origins case-insensitively', () => {
    expect(checkRunsControlAuth({ cfg: { enabled: true, token: null }, origin: 'HTTP://LOCALHOST:8080', allowedOrigins: allow, authorization: undefined })).toBe('ok')
  })

  it('reports disabled before anything else', () => {
    expect(checkRunsControlAuth({ cfg: { enabled: false, token: null }, origin: 'http://localhost:8080', allowedOrigins: allow, authorization: undefined })).toBe('disabled')
  })
})
