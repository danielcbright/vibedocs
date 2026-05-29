import { describe, it, expect } from 'vitest'
import {
  readOnlyGate,
  tokenConfiguredGate,
  authorizedGate,
  extensionGate,
  sizeGate,
  runUploadPipeline,
  UPLOAD_GATES,
  type UploadGateContext,
} from '../src/upload-pipeline.js'
import { DEFAULT_MAX_UPLOAD_BYTES, type UploadAuthConfig } from '../src/upload-auth.js'

// Helpers ────────────────────────────────────────────────────────────────────

function mkFile(name: string, size = 4): File {
  return new File([new Uint8Array(size)], name)
}

function ctx(partial: Partial<UploadGateContext> = {}): UploadGateContext {
  const baseCfg: UploadAuthConfig = {
    readOnly: false,
    token: 'secret',
    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  }
  return {
    authCfg: partial.authCfg ?? baseCfg,
    authorizationHeader: partial.authorizationHeader,
    files: partial.files ?? [mkFile('note.md')],
  }
}

// ── Gate 1: read-only ────────────────────────────────────────────────────────

describe('readOnlyGate', () => {
  it('rejects with 404 when readOnly=true (even with valid token)', () => {
    const result = readOnlyGate(
      ctx({
        authCfg: { readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES },
        authorizationHeader: 'Bearer secret',
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(404)
      expect(result.error.bodyType).toBe('text')
    }
  })

  it('passes when readOnly=false', () => {
    const result = readOnlyGate(ctx({ authCfg: { readOnly: false, token: 'secret', maxBytes: 100 } }))
    expect(result.kind).toBe('pass')
  })
})

// ── Gate 2: no-token-configured ──────────────────────────────────────────────

describe('tokenConfiguredGate', () => {
  it('rejects with 404 when token is null (endpoint pretends not to exist)', () => {
    const result = tokenConfiguredGate(
      ctx({ authCfg: { readOnly: false, token: null, maxBytes: 100 }, authorizationHeader: 'Bearer anything' }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(404)
      expect(result.error.bodyType).toBe('text')
    }
  })

  it('passes when a token is configured', () => {
    const result = tokenConfiguredGate(ctx())
    expect(result.kind).toBe('pass')
  })
})

// ── Gate 3: authorized (token match) ─────────────────────────────────────────

describe('authorizedGate', () => {
  it('rejects with 401 when no Authorization header', () => {
    const result = authorizedGate(ctx({ authorizationHeader: undefined }))
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(401)
      expect(result.error.bodyType).toBe('json')
    }
  })

  it('rejects with 401 on wrong token', () => {
    const result = authorizedGate(ctx({ authorizationHeader: 'Bearer wrong' }))
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(401)
    }
  })

  it('passes with correct token', () => {
    const result = authorizedGate(ctx({ authorizationHeader: 'Bearer secret' }))
    expect(result.kind).toBe('pass')
  })
})

// ── Gate 4: extension allowlist ──────────────────────────────────────────────

describe('extensionGate', () => {
  it('rejects with 400 when a file has a denied extension (.html)', () => {
    const result = extensionGate(ctx({ files: [mkFile('evil.html')] }))
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(400)
      expect(result.error.bodyType).toBe('json')
      expect(result.error.message).toContain('evil.html')
    }
  })

  it('rejects when ANY file has a denied extension (all-or-nothing)', () => {
    const result = extensionGate(ctx({ files: [mkFile('ok.md'), mkFile('evil.svg')] }))
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(400)
      expect(result.error.message).toContain('evil.svg')
    }
  })

  it('passes when all extensions are allowlisted', () => {
    const result = extensionGate(ctx({ files: [mkFile('a.md'), mkFile('b.png')] }))
    expect(result.kind).toBe('pass')
  })
})

// ── Gate 5: size cap ─────────────────────────────────────────────────────────

describe('sizeGate', () => {
  it('rejects with 413 when a file exceeds maxBytes', () => {
    const result = sizeGate(
      ctx({
        authCfg: { readOnly: false, token: 'secret', maxBytes: 1024 },
        files: [mkFile('big.md', 2048)],
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(413)
      expect(result.error.bodyType).toBe('json')
      expect(result.error.message).toContain('big.md')
    }
  })

  it('passes when all files are within the size cap', () => {
    const result = sizeGate(
      ctx({
        authCfg: { readOnly: false, token: 'secret', maxBytes: 10_000 },
        files: [mkFile('small.md', 100)],
      }),
    )
    expect(result.kind).toBe('pass')
  })
})

// ── Pipeline composition & ordering ──────────────────────────────────────────

describe('UPLOAD_GATES ordering invariant', () => {
  // This test is the structural guard. Reordering UPLOAD_GATES in the source
  // changes the security model — this test fires loudly when that happens.
  it('lists gates in the exact security-critical order', () => {
    const names = UPLOAD_GATES.map((g) => g.name)
    expect(names).toEqual([
      'readOnlyGate',
      'tokenConfiguredGate',
      'authorizedGate',
      'extensionGate',
      'sizeGate',
    ])
  })

  // Phase invariant: every auth gate appears before every content gate.
  // The HTTP handler runs auth gates before parsing the request body, then
  // content gates after. If a future change inserts a content gate before
  // an auth gate, the handler's two-phase execution model would silently
  // change observable behavior.
  it('places every auth gate before every content gate', () => {
    const phases = UPLOAD_GATES.map((g) => g.phase)
    const lastAuthIdx = phases.lastIndexOf('auth')
    const firstContentIdx = phases.indexOf('content')
    expect(lastAuthIdx).toBeLessThan(firstContentIdx)
  })
})

describe('runUploadPipeline composition', () => {
  it('returns first rejection (read-only beats token mismatch)', () => {
    const result = runUploadPipeline(
      ctx({
        authCfg: { readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES },
        authorizationHeader: 'Bearer wrong',
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(404)
    }
  })

  it('returns first rejection (no-token-configured beats extension/size)', () => {
    const result = runUploadPipeline(
      ctx({
        authCfg: { readOnly: false, token: null, maxBytes: 1 },
        files: [mkFile('evil.html', 9999)],
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(404)
    }
  })

  it('returns first rejection (unauthorized beats extension check)', () => {
    const result = runUploadPipeline(
      ctx({
        authCfg: { readOnly: false, token: 'right', maxBytes: DEFAULT_MAX_UPLOAD_BYTES },
        authorizationHeader: 'Bearer wrong',
        files: [mkFile('evil.html')],
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns first rejection (extension beats size)', () => {
    const result = runUploadPipeline(
      ctx({
        authCfg: { readOnly: false, token: 'secret', maxBytes: 1 },
        authorizationHeader: 'Bearer secret',
        files: [mkFile('evil.html', 9999)],
      }),
    )
    expect(result.kind).toBe('reject')
    if (result.kind === 'reject') {
      expect(result.error.status).toBe(400)
    }
  })

  it('passes when every gate passes (all good)', () => {
    const result = runUploadPipeline(
      ctx({
        authCfg: { readOnly: false, token: 'secret', maxBytes: 10_000 },
        authorizationHeader: 'Bearer secret',
        files: [mkFile('a.md', 4), mkFile('b.png', 4)],
      }),
    )
    expect(result.kind).toBe('pass')
  })
})
