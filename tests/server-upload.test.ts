import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, stat, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { safeWriteFile } from '../src/upload.js'
import { VibedocsError, registerErrorHandler } from '../src/errors.js'
import { PathResolver } from '../src/path-resolver.js'
import { registerFileRoute } from '../src/server-routes.js'

let tmpDir: string

function createTestApp(projectsDir: string) {
  const app = new Hono()
  registerErrorHandler(app)
  const assetResolver = new PathResolver({ projectsDir })

  registerFileRoute(app, assetResolver)

  app.post('/api/upload/:project/*', async (c) => {
    const project = c.req.param('project')
    const fullPath = new URL(c.req.url).pathname
    const prefix = `/api/upload/${encodeURIComponent(project)}/`
    const folderPath = fullPath.startsWith(prefix)
      ? decodeURIComponent(fullPath.slice(prefix.length))
      : (c.req.param('*') || '')

    const targetDir = assetResolver.resolve(project, folderPath)

    let s: Awaited<ReturnType<typeof stat>>
    try {
      s = await stat(targetDir)
    } catch (err) {
      throw new VibedocsError('not-found', 'Target folder not found', { cause: err })
    }
    if (!s.isDirectory()) throw new VibedocsError('invalid', 'Target is not a directory')

    const body = await c.req.parseBody({ all: true })
    const files = body['files']
    if (!files) return c.json({ error: 'No files provided' }, 400)

    const fileList = Array.isArray(files) ? files : [files]
    const uploaded = fileList.filter((f): f is File => f instanceof File)
    if (uploaded.length === 0) return c.json({ error: 'No files provided' }, 400)

    const results = []
    for (const file of uploaded) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await safeWriteFile(targetDir, file.name, buffer)
      results.push(result)
    }

    return c.json({ data: results })
  })

  return app
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-server-test-'))
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('POST /api/upload/:project/*', () => {
  it('uploads a file to the target folder', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['# Test'], 'test.md', { type: 'text/markdown' }))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].savedName).toBe('test.md')

    const content = await readFile(path.join(tmpDir, 'myproject', 'docs', 'test.md'), 'utf-8')
    expect(content).toBe('# Test')
  })

  it('uploads multiple files', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['a'], 'a.md'))
    formData.append('files', new File(['b'], 'b.md'))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(2)
  })

  it('rejects path traversal', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['bad'], 'evil.md'))

    // Use %2F encoding to bypass URL normalization and test resolveUploadDir's traversal guard
    const res = await app.request('/api/upload/myproject/..%2F..%2Fetc', { method: 'POST', body: formData })
    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent folder', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['x'], 'x.md'))

    const res = await app.request('/api/upload/myproject/nonexistent', { method: 'POST', body: formData })
    expect(res.status).toBe(404)
  })

  it('returns 400 when no files attached', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(400)
  })

  it('auto-renames on conflict', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'exist.md'), 'old')
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['new'], 'exist.md'))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].savedName).toBe('exist-1.md')
  })
})

describe('GET /api/file/:project/*', () => {
  it('serves a PNG image with image/png content-type, inline disposition, and nosniff', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'screenshot.png'), 'fake-png-data')
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/screenshot.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/)
    const body = await res.text()
    expect(body).toBe('fake-png-data')
  })

  it('serves uploaded .html as application/octet-stream with attachment disposition (XSS defense)', async () => {
    // Upload evil.html via the real upload route, then GET it back and assert headers.
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['<script>alert(1)</script>'], 'evil.html'))

    const uploadRes = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(uploadRes.status).toBe(200)

    const res = await app.request('/api/file/myproject/docs/evil.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/)
    // Filename should also be in the disposition for nicer downloads.
    expect(res.headers.get('Content-Disposition')).toContain('evil.html')
  })

  it('serves uploaded .svg as application/octet-stream with attachment disposition (XSS defense)', async () => {
    await writeFile(
      path.join(tmpDir, 'myproject', 'docs', 'evil.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    )
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/evil.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/)
  })

  it('serves JPG, GIF, WEBP inline as their respective image types', async () => {
    const cases: Array<[string, string]> = [
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['anim.gif', 'image/gif'],
      ['photo.webp', 'image/webp'],
    ]
    for (const [name] of cases) {
      await writeFile(path.join(tmpDir, 'myproject', 'docs', name), 'bytes')
    }
    const app = createTestApp(tmpDir)
    for (const [name, expectedType] of cases) {
      const res = await app.request(`/api/file/myproject/docs/${name}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe(expectedType)
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Content-Disposition')).toMatch(/^inline/)
    }
  })

  it('serves PDFs and text with attachment disposition (non-image content)', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'doc.pdf'), '%PDF-1.4')
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'notes.txt'), 'hello')
    const app = createTestApp(tmpDir)

    const pdfRes = await app.request('/api/file/myproject/docs/doc.pdf')
    expect(pdfRes.headers.get('Content-Disposition')).toMatch(/^attachment/)
    expect(pdfRes.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const txtRes = await app.request('/api/file/myproject/docs/notes.txt')
    expect(txtRes.headers.get('Content-Disposition')).toMatch(/^attachment/)
    expect(txtRes.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('returns 404 for nonexistent file', async () => {
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/nope.png')
    expect(res.status).toBe(404)
  })

  it('rejects path traversal attempts', async () => {
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/..%2F..%2Fetc/passwd')
    expect(res.status).toBe(400)
  })

  it('uses fallback content-type for unknown extensions with attachment disposition + nosniff', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'data.xyz'), 'binary-stuff')
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/data.xyz')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/)
  })
})
