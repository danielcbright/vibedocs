import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { registerStaticRoutes } from '../src/static-files.js'

/**
 * Static-files seam test (#108, Seam 4). Verifies:
 *  - `/assets/*` returns 404 for nonexistent files
 *  - `/assets/*` returns the bundled file when present, with the right
 *    content-type
 *  - catch-all returns the exact file when present (e.g. favicon.ico)
 *  - catch-all falls back to index.html for unknown paths (SPA hash router)
 *  - the CONTENT_TYPES map maps html / js / css correctly
 *
 * Fixtures live in a tmpdir styled like `frontend/dist/`:
 *
 *   <tmp>/index.html
 *   <tmp>/favicon.ico
 *   <tmp>/assets/app.js
 *   <tmp>/assets/styles.css
 */

let tmpDist: string
let app: Hono

beforeEach(async () => {
  tmpDist = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-static-test-'))
  await mkdir(path.join(tmpDist, 'assets'), { recursive: true })
  await writeFile(path.join(tmpDist, 'index.html'), '<!doctype html><title>x</title>')
  await writeFile(path.join(tmpDist, 'favicon.ico'), Buffer.from([0, 0, 1, 0]))
  await writeFile(path.join(tmpDist, 'assets', 'app.js'), 'console.log("hi")')
  await writeFile(path.join(tmpDist, 'assets', 'styles.css'), 'body{margin:0}')

  app = new Hono()
  registerStaticRoutes(app, tmpDist)
})

afterEach(async () => {
  await rm(tmpDist, { recursive: true, force: true })
})

describe('registerStaticRoutes — /assets/*', () => {
  it('serves an existing asset with the correct content-type (.js)', async () => {
    const res = await app.request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(await res.text()).toBe('console.log("hi")')
  })

  it('serves an existing asset with the correct content-type (.css)', async () => {
    const res = await app.request('/assets/styles.css')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(await res.text()).toBe('body{margin:0}')
  })

  it('returns 404 for a non-existent asset', async () => {
    const res = await app.request('/assets/does-not-exist.js')
    expect(res.status).toBe(404)
  })
})

describe('registerStaticRoutes — catch-all', () => {
  it('serves an exact file (favicon.ico) when present', async () => {
    const res = await app.request('/favicon.ico')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/x-icon')
  })

  it('falls back to index.html for unknown paths (SPA hash routing)', async () => {
    const res = await app.request('/some/unknown/path')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('<!doctype html>')
  })

  it('falls back to index.html for the root path', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  it('returns 404 when neither exact file nor index.html exists', async () => {
    // Remove index.html to force the deep fallback path.
    await rm(path.join(tmpDist, 'index.html'))
    const res = await app.request('/any/path')
    expect(res.status).toBe(404)
  })
})

describe('registerStaticRoutes — CONTENT_TYPES coverage', () => {
  it('serves .html as text/html', async () => {
    await writeFile(path.join(tmpDist, 'page.html'), '<p>page</p>')
    const res = await app.request('/page.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  it('serves the PWA manifest as application/manifest+json', async () => {
    await writeFile(path.join(tmpDist, 'manifest.webmanifest'), '{"name":"x"}')
    const res = await app.request('/manifest.webmanifest')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/manifest+json; charset=utf-8')
  })

  it('serves the service worker (/sw.js) as javascript so the browser will register it', async () => {
    await writeFile(path.join(tmpDist, 'sw.js'), 'self.addEventListener("install",()=>{})')
    const res = await app.request('/sw.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
  })

  it('falls back to application/octet-stream for unknown extensions', async () => {
    await writeFile(path.join(tmpDist, 'mystery.xyz'), 'opaque')
    const res = await app.request('/mystery.xyz')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })
})
