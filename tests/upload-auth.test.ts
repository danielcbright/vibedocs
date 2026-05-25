import { describe, it, expect } from 'vitest'
import {
  parseUploadAuthConfig,
  checkUploadAuth,
  checkExtensionAllowed,
  DEFAULT_ALLOWED_EXTENSIONS,
  DEFAULT_DENIED_EXTENSIONS,
  DEFAULT_MAX_UPLOAD_BYTES,
} from '../src/upload-auth.js'

// ── parseUploadAuthConfig ─────────────────────────────────────────────────────

describe('parseUploadAuthConfig', () => {
  it('defaults read-only=false and token=null when env is empty', () => {
    const cfg = parseUploadAuthConfig({})
    expect(cfg.readOnly).toBe(false)
    expect(cfg.token).toBeNull()
    expect(cfg.maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })

  it('treats VIBEDOCS_READ_ONLY=true (case-insensitive) as truthy', () => {
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'true' }).readOnly).toBe(true)
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'TRUE' }).readOnly).toBe(true)
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: '1' }).readOnly).toBe(true)
  })

  it('treats other VIBEDOCS_READ_ONLY values as falsy', () => {
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'false' }).readOnly).toBe(false)
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: '' }).readOnly).toBe(false)
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: '0' }).readOnly).toBe(false)
    expect(parseUploadAuthConfig({ VIBEDOCS_READ_ONLY: 'no' }).readOnly).toBe(false)
  })

  it('captures VIBEDOCS_UPLOAD_TOKEN as the shared secret', () => {
    const cfg = parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: 'secret123' })
    expect(cfg.token).toBe('secret123')
  })

  it('treats empty-string VIBEDOCS_UPLOAD_TOKEN as unset (null)', () => {
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: '' }).token).toBeNull()
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_TOKEN: '   ' }).token).toBeNull()
  })

  it('parses VIBEDOCS_UPLOAD_MAX_BYTES as integer', () => {
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_MAX_BYTES: '20971520' }).maxBytes).toBe(20971520)
  })

  it('ignores invalid VIBEDOCS_UPLOAD_MAX_BYTES and falls back to default', () => {
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_MAX_BYTES: 'abc' }).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_MAX_BYTES: '0' }).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(parseUploadAuthConfig({ VIBEDOCS_UPLOAD_MAX_BYTES: '-5' }).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })
})

// ── checkUploadAuth ──────────────────────────────────────────────────────────

describe('checkUploadAuth', () => {
  it('returns "read-only" when readOnly=true (regardless of token)', () => {
    const cfg = { readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, 'Bearer secret')).toBe('read-only')
    expect(checkUploadAuth(cfg, undefined)).toBe('read-only')
  })

  it('returns "no-token-configured" when readOnly=false and token is null', () => {
    const cfg = { readOnly: false, token: null, maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, undefined)).toBe('no-token-configured')
    expect(checkUploadAuth(cfg, 'Bearer anything')).toBe('no-token-configured')
  })

  it('returns "unauthorized" when token configured but missing/invalid', () => {
    const cfg = { readOnly: false, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, undefined)).toBe('unauthorized')
    expect(checkUploadAuth(cfg, '')).toBe('unauthorized')
    expect(checkUploadAuth(cfg, 'Bearer wrong')).toBe('unauthorized')
    expect(checkUploadAuth(cfg, 'wrong')).toBe('unauthorized')
  })

  it('returns "ok" when token configured and matches', () => {
    const cfg = { readOnly: false, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, 'Bearer secret')).toBe('ok')
  })

  it('is whitespace-tolerant in the Authorization header', () => {
    const cfg = { readOnly: false, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, 'Bearer    secret')).toBe('ok')
  })

  it('uses constant-time comparison (long wrong token does not return ok)', () => {
    const cfg = { readOnly: false, token: 'short', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }
    expect(checkUploadAuth(cfg, 'Bearer shortbutlonger')).toBe('unauthorized')
  })
})

// ── checkExtensionAllowed ────────────────────────────────────────────────────

describe('checkExtensionAllowed', () => {
  it('accepts default allowlisted extensions', () => {
    for (const ext of DEFAULT_ALLOWED_EXTENSIONS) {
      expect(checkExtensionAllowed(`file${ext}`)).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(checkExtensionAllowed('file.MD')).toBe(true)
    expect(checkExtensionAllowed('file.PNG')).toBe(true)
    expect(checkExtensionAllowed('file.HTML')).toBe(false)
  })

  it('rejects denied extensions', () => {
    for (const ext of DEFAULT_DENIED_EXTENSIONS) {
      expect(checkExtensionAllowed(`bad${ext}`)).toBe(false)
    }
  })

  it('rejects files with no extension', () => {
    expect(checkExtensionAllowed('Makefile')).toBe(false)
  })

  it('rejects unknown extensions not in the allowlist', () => {
    expect(checkExtensionAllowed('file.exe')).toBe(false)
    expect(checkExtensionAllowed('file.sh')).toBe(false)
    expect(checkExtensionAllowed('file.docx')).toBe(false)
  })

  it('rejects double extensions where the final extension is denied (.tar.html)', () => {
    expect(checkExtensionAllowed('archive.tar.html')).toBe(false)
  })
})
