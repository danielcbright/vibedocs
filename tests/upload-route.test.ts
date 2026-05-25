import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { registerErrorHandler } from '../src/errors.js'
import { PathResolver } from '../src/path-resolver.js'
import { registerUploadRoute, registerConfigRoute } from '../src/upload-route.js'
import {
  parseUploadAuthConfig,
  DEFAULT_MAX_UPLOAD_BYTES,
  type UploadAuthConfig,
} from '../src/upload-auth.js'

let tmpDir: string

function createApp(authCfg: UploadAuthConfig) {
  const app = new Hono()
  registerErrorHandler(app)
  const assetResolver = new PathResolver({ projectsDir: tmpDir })
  registerConfigRoute(app, authCfg)
  registerUploadRoute(app, assetResolver, authCfg, () => {})
  return app
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-upload-route-test-'))
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ── Mode: read-only ──────────────────────────────────────────────────────────

describe('upload route — read-only mode', () => {
  it('returns 404 unconditionally (with no token configured)', async () => {
    const app = createApp({ readOnly: true, token: null, maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: fd })
    expect(res.status).toBe(404)
  })

  it('returns 404 even when a valid token is provided', async () => {
    const app = createApp({ readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(404)
  })
})

// ── Mode: no token configured (default local dev) ────────────────────────────

describe('upload route — no token configured', () => {
  it('returns 404 with no header (endpoint pretends not to exist)', async () => {
    const app = createApp({ readOnly: false, token: null, maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: fd })
    expect(res.status).toBe(404)
  })

  it('returns 404 even with a bearer header (no token configured → 404, not 401)', async () => {
    const app = createApp({ readOnly: false, token: null, maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('whatever'),
    })
    expect(res.status).toBe(404)
  })
})

// ── Mode: token configured ───────────────────────────────────────────────────

describe('upload route — token configured', () => {
  const cfg: UploadAuthConfig = { readOnly: false, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES }

  it('returns 401 when no Authorization header', async () => {
    const app = createApp(cfg)
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: fd })
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong token', async () => {
    const app = createApp(cfg)
    const fd = new FormData()
    fd.append('files', new File(['# x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('wrong'),
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 on valid token with allowed extension', async () => {
    const app = createApp(cfg)
    const fd = new FormData()
    fd.append('files', new File(['# hi'], 'note.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].savedName).toBe('note.md')
  })

  it('returns 400 when an uploaded file has a denied extension (.html)', async () => {
    const app = createApp(cfg)
    const fd = new FormData()
    fd.append('files', new File(['<script>x</script>'], 'evil.html'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when ANY uploaded file has a denied extension (all-or-nothing)', async () => {
    const app = createApp(cfg)
    const fd = new FormData()
    fd.append('files', new File(['ok'], 'ok.md'))
    fd.append('files', new File(['bad'], 'evil.svg'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(400)
  })

  it('returns 413 when an uploaded file exceeds the per-file size cap', async () => {
    const smallCap: UploadAuthConfig = { readOnly: false, token: 'secret', maxBytes: 1024 }
    const app = createApp(smallCap)
    const big = new Uint8Array(2048) // 2 KB > 1 KB cap
    const fd = new FormData()
    fd.append('files', new File([big], 'big.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(413)
  })
})

// ── /api/config ──────────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  it('returns uploadEnabled=false when no token configured', async () => {
    const app = createApp({ readOnly: false, token: null, maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.uploadEnabled).toBe(false)
  })

  it('returns uploadEnabled=false in read-only mode (even with token)', async () => {
    const app = createApp({ readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const res = await app.request('/api/config')
    const json = await res.json()
    expect(json.uploadEnabled).toBe(false)
  })

  it('returns uploadEnabled=true when token configured and not read-only', async () => {
    const app = createApp({ readOnly: false, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const res = await app.request('/api/config')
    const json = await res.json()
    expect(json.uploadEnabled).toBe(true)
  })
})

// ── Composition rule (precedence) ────────────────────────────────────────────

describe('upload route — composition rule', () => {
  it('read-only beats token (read-only → 404 first)', async () => {
    const app = createApp({ readOnly: true, token: 'secret', maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['x'], 'x.md'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(404)
  })

  it('no-token-configured beats extension/size checks (404, not 400/413)', async () => {
    const app = createApp({ readOnly: false, token: null, maxBytes: 1 })
    const fd = new FormData()
    fd.append('files', new File(['<script>'.repeat(100)], 'evil.html'))
    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: fd })
    expect(res.status).toBe(404)
  })

  it('unauthorized beats extension check (401, not 400)', async () => {
    const app = createApp({ readOnly: false, token: 'right', maxBytes: DEFAULT_MAX_UPLOAD_BYTES })
    const fd = new FormData()
    fd.append('files', new File(['<script>'], 'evil.html'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('wrong'),
    })
    expect(res.status).toBe(401)
  })

  it('extension check beats size check (400, not 413)', async () => {
    const app = createApp({ readOnly: false, token: 'secret', maxBytes: 1 })
    const fd = new FormData()
    fd.append('files', new File([new Uint8Array(10)], 'evil.html'))
    const res = await app.request('/api/upload/myproject/docs', {
      method: 'POST',
      body: fd,
      headers: bearer('secret'),
    })
    expect(res.status).toBe(400)
  })
})

// ── parseUploadAuthConfig from process.env shape ─────────────────────────────

describe('parseUploadAuthConfig (process.env shape)', () => {
  it('handles process.env-style input transparently', () => {
    const cfg = parseUploadAuthConfig({
      VIBEDOCS_UPLOAD_TOKEN: 'abc',
      VIBEDOCS_READ_ONLY: 'true',
      VIBEDOCS_UPLOAD_MAX_BYTES: '500',
    })
    expect(cfg.token).toBe('abc')
    expect(cfg.readOnly).toBe(true)
    expect(cfg.maxBytes).toBe(500)
  })
})
