import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { registerErrorHandler } from '../src/errors.js'
import { registerExternalFileRoutes, renderExternalFile, type ExternalFileRoutesDeps } from '../src/external-file-routes.js'
import { externalPathFromHashPath, EXTERNAL_PROJECT } from '../src/shared/external-file.js'

/**
 * `/api/external/*` — a markdown file by absolute path, outside every project
 * (#223). This machine's browser only; the roots, dot-folder and excluded-folder
 * rules do not apply.
 */
const PORT = 8080
const LOCAL = { Host: `localhost:${PORT}` }

let tmp: string
let note: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-external-'))
  note = path.join(tmp, '.claude', 'memory', 'note.md')
  await mkdir(path.dirname(note), { recursive: true })
  await writeFile(note, '# A note\n\nSee ![diagram](../img/d.png) and ![up](./x.svg).\n\n## Section\n\nBody.\n')
  await mkdir(path.join(tmp, '.claude', 'img'), { recursive: true })
  await writeFile(path.join(tmp, '.claude', 'img', 'd.png'), 'png')
  await writeFile(path.join(tmp, '.claude', 'memory', 'x.svg'), '<svg/>')
  await writeFile(path.join(tmp, 'plain.txt'), 'txt')
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function appWith(overrides: Partial<ExternalFileRoutesDeps> = {}, peer = '127.0.0.1') {
  const app = new Hono()
  registerErrorHandler(app)
  registerExternalFileRoutes(app, { port: () => PORT, peerAddress: () => peer, ...overrides })
  return app
}

const q = (route: string, abs: string) => `/api/external/${route}?path=${encodeURIComponent(abs)}`

describe('GET /api/external/render', () => {
  it('renders a markdown file under a dot-directory outside every root', async () => {
    const res = await appWith().request(q('render', note), { headers: LOCAL })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { html: string; toc: unknown[] } }
    expect(data.html).toContain('A note')
    expect(data.toc.length).toBeGreaterThanOrEqual(2)
  })

  it('points relative assets at /api/external/file by absolute path', async () => {
    const page = await renderExternalFile(note)
    expect(page.html).toContain(`/api/external/file?path=${encodeURIComponent(path.join(tmp, '.claude', 'img', 'd.png'))}`)
    expect(page.html).toContain(`/api/external/file?path=${encodeURIComponent(path.join(tmp, '.claude', 'memory', 'x.svg'))}`)
  })

  it('404s a missing file', async () => {
    expect((await appWith().request(q('render', path.join(tmp, 'nope.md')), { headers: LOCAL })).status).toBe(404)
  })

  it('400s a non-markdown file, a directory, a relative path and no path', async () => {
    const app = appWith()
    expect((await app.request(q('render', path.join(tmp, 'plain.txt')), { headers: LOCAL })).status).toBe(400)
    expect((await app.request(q('render', path.dirname(note) + '.md'), { headers: LOCAL })).status).toBe(404)
    expect((await app.request('/api/external/render?path=note.md', { headers: LOCAL })).status).toBe(400)
    expect((await app.request('/api/external/render', { headers: LOCAL })).status).toBe(400)
  })
})

describe('GET /api/external/raw and /file', () => {
  it('serves the markdown source as text', async () => {
    const res = await appWith().request(q('raw', note), { headers: LOCAL })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('# A note')
  })

  it('refuses raw for a non-markdown file', async () => {
    expect((await appWith().request(q('raw', path.join(tmp, 'plain.txt')), { headers: LOCAL })).status).toBe(400)
  })

  it('serves an asset under the /api/file content-type policy: images inline, svg as a download', async () => {
    const app = appWith()
    const png = await app.request(q('file', path.join(tmp, '.claude', 'img', 'd.png')), { headers: LOCAL })
    expect(png.status).toBe(200)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-disposition')).toMatch(/^inline/)
    const svg = await app.request(q('file', path.join(tmp, '.claude', 'memory', 'x.svg')), { headers: LOCAL })
    expect(svg.headers.get('content-type')).toBe('application/octet-stream')
    expect(svg.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(svg.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('400s a directory', async () => {
    expect((await appWith().request(q('file', path.dirname(note)), { headers: LOCAL })).status).toBe(400)
  })
})

describe('this machine only', () => {
  it('403s a non-loopback peer whatever the headers say', async () => {
    const res = await appWith({}, '10.0.0.7').request(q('render', note), { headers: LOCAL })
    expect(res.status).toBe(403)
  })

  it('403s a loopback peer whose Host is not loopback (DNS rebinding)', async () => {
    const res = await appWith().request(q('render', note), { headers: { Host: 'docs.evil.example:8080' } })
    expect(res.status).toBe(403)
  })

  it('accepts IPv4-mapped loopback and 127.0.0.1 as Host', async () => {
    const res = await appWith({}, '::ffff:127.0.0.1').request(q('raw', note), { headers: { Host: `127.0.0.1:${PORT}` } })
    expect(res.status).toBe(200)
  })

  it('gates every /api/external route, including the asset one', async () => {
    const res = await appWith({}, '10.0.0.7').request(q('file', path.join(tmp, '.claude', 'img', 'd.png')), { headers: LOCAL })
    expect(res.status).toBe(403)
  })
})

describe('hash contract shared with the frontend', () => {
  it('decodes #/file<abs> back to the absolute path', () => {
    expect(externalPathFromHashPath('file/Users/me/My%20Notes.md')).toBe('/Users/me/My Notes.md')
    expect(externalPathFromHashPath('runs/abc')).toBeNull()
    expect(externalPathFromHashPath(null)).toBeNull()
    expect(externalPathFromHashPath('file/%E0%A4%A')).toBeNull()
  })

  it('uses a project name no directory can have', () => {
    expect(EXTERNAL_PROJECT).toContain('/')
  })
})
