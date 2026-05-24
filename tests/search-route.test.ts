import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { createIndexStore } from '../src/search.js'
import { registerSearchRoute } from '../src/server-routes.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-search-route-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/search', () => {
  it('returns results and the current store version', async () => {
    const projectDir = path.join(tmpDir, 'gamma')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'notes.md'), '# Gamma\n\nsphinx of black quartz.')

    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()

    const app = new Hono()
    registerSearchRoute(app, store)

    const res = await app.request('/api/search?q=sphinx')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.version).toBe(1)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].project).toBe('gamma')
  })

  it('returns empty results but still includes version for short queries', async () => {
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    await store.rebuild()

    const app = new Hono()
    registerSearchRoute(app, store)

    const res = await app.request('/api/search?q=a')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual([])
    expect(json.version).toBe(2)
  })

  it('reflects updated version after a subsequent rebuild', async () => {
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()

    const app = new Hono()
    registerSearchRoute(app, store)

    const before = await (await app.request('/api/search?q=zz')).json()
    expect(before.version).toBe(1)

    await store.rebuild()

    const after = await (await app.request('/api/search?q=zz')).json()
    expect(after.version).toBe(2)
  })
})
