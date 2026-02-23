import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, stat, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { resolveUploadDir, safeWriteFile } from '../src/upload.js'

let tmpDir: string

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function createTestApp(projectsDir: string) {
  const app = new Hono()

  app.get('/api/file/:project/*', async (c) => {
    const project = c.req.param('project')
    const fullPath = new URL(c.req.url).pathname
    const prefix = `/api/file/${encodeURIComponent(project)}/`
    const filePath = fullPath.startsWith(prefix)
      ? decodeURIComponent(fullPath.slice(prefix.length))
      : (c.req.param('*') || '')

    if (!project || !filePath) return c.json({ error: 'Missing project or path' }, 400)

    const dirPart = path.dirname(filePath)
    const filePart = path.basename(filePath)
    const resolvedDir = resolveUploadDir(projectsDir, project, dirPart === '.' ? '' : dirPart)
    if (!resolvedDir) return c.json({ error: 'Invalid path' }, 400)
    const resolved = path.join(resolvedDir, filePart)

    if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
      return c.json({ error: 'Invalid path' }, 400)
    }

    try {
      const content = await readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
      return new Response(content, { headers: { 'Content-Type': contentType } })
    } catch (err: any) {
      if (err.code === 'ENOENT') return c.json({ error: 'File not found' }, 404)
      return c.json({ error: 'Failed to read file' }, 500)
    }
  })

  app.post('/api/upload/:project/*', async (c) => {
    const project = c.req.param('project')
    const fullPath = new URL(c.req.url).pathname
    const prefix = `/api/upload/${encodeURIComponent(project)}/`
    const folderPath = fullPath.startsWith(prefix)
      ? decodeURIComponent(fullPath.slice(prefix.length))
      : (c.req.param('*') || '')

    const targetDir = resolveUploadDir(projectsDir, project, folderPath)
    if (!targetDir) return c.json({ error: 'Invalid path' }, 400)

    try {
      const s = await stat(targetDir)
      if (!s.isDirectory()) return c.json({ error: 'Target is not a directory' }, 400)
    } catch {
      return c.json({ error: 'Target folder not found' }, 404)
    }

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
  it('serves an existing file with correct content-type', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'screenshot.png'), 'fake-png-data')
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/screenshot.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const body = await res.text()
    expect(body).toBe('fake-png-data')
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

  it('uses fallback content-type for unknown extensions', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'data.xyz'), 'binary-stuff')
    const app = createTestApp(tmpDir)

    const res = await app.request('/api/file/myproject/docs/data.xyz')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })
})
