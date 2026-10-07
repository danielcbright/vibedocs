import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { registerProjectsRoute } from '../src/server-routes.js'
import { filterProjects, type FileTypeFilter, type ProjectInfo } from '../src/discovery.js'

/**
 * `GET /api/projects` from the in-memory tree: an ETag per version and file type,
 * a bodiless 304 for a tab that is current, and one serialisation shared by every
 * tab that asks after a change.
 */
const projects: ProjectInfo[] = [
  {
    name: 'demo',
    hasDocsFolder: false,
    tree: [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'logo.png', path: 'logo.png', type: 'file', isAsset: true },
    ],
  },
]

function setup() {
  let version = 1
  let lists = 0
  const app = new Hono()
  registerProjectsRoute(app, {
    version: () => version,
    listVersioned: async (fileType: FileTypeFilter) => {
      lists++
      return { projects: filterProjects(projects, fileType), version }
    },
  })
  return { app, bump: () => version++, lists: () => lists }
}

describe('GET /api/projects', () => {
  it('returns the list with its version, an ETag, and no-cache so the browser revalidates', async () => {
    const { app } = setup()
    const res = await app.request('/api/projects?fileType=markdown')
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"1-markdown"')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.data[0].tree.map((n: { name: string }) => n.name)).toEqual(['README.md'])
  })

  it('answers a current tab with a bodiless 304, without listing anything', async () => {
    const { app, lists } = setup()
    await app.request('/api/projects')
    const before = lists()
    const res = await app.request('/api/projects', { headers: { 'If-None-Match': '"1-all"' } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(lists()).toBe(before)
  })

  it('sends the new list once the version moves, and serialises it once for every tab', async () => {
    const { app, bump, lists } = setup()
    await app.request('/api/projects')
    bump()
    const stale = await app.request('/api/projects', { headers: { 'If-None-Match': '"1-all"' } })
    expect(stale.status).toBe(200)
    expect(stale.headers.get('etag')).toBe('"2-all"')
    const listsAfterFirstTab = lists()
    await app.request('/api/projects', { headers: { 'If-None-Match': '"1-all"' } })
    expect(lists()).toBe(listsAfterFirstTab)
  })

  it('keeps one ETag per file type, since the bodies differ', async () => {
    const { app } = setup()
    const all = await app.request('/api/projects?fileType=all')
    const md = await app.request('/api/projects?fileType=markdown', { headers: { 'If-None-Match': all.headers.get('etag')! } })
    expect(md.status).toBe(200)
  })
})
