import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  filterProjects,
  parseFileTypeFilter,
  type FileNode,
  type ProjectInfo,
} from '../src/discovery.js'

/**
 * Mirror the production /api/projects route, but inject a fixture projects array
 * instead of touching the filesystem. Uses the same parseFileTypeFilter +
 * filterProjects helpers the production route uses, so this test exercises the
 * real filtering pipeline.
 */
function createTestApp(projects: ProjectInfo[]) {
  const app = new Hono()

  app.get('/api/projects', (c) => {
    const fileType = parseFileTypeFilter(c.req.query('fileType'))
    return c.json({ data: filterProjects(projects, fileType) })
  })

  return app
}

function fixture(): ProjectInfo[] {
  const mixedTree: FileNode[] = [
    {
      name: 'docs',
      path: 'docs',
      type: 'folder',
      children: [
        { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
        { name: 'screenshot.png', path: 'docs/screenshot.png', type: 'file', isAsset: true },
      ],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ]

  const assetOnlyTree: FileNode[] = [
    { name: 'logo.svg', path: 'logo.svg', type: 'file', isAsset: true },
  ]

  return [
    { name: 'alpha', hasDocsFolder: true, tree: mixedTree },
    { name: 'beta', hasDocsFolder: false, tree: assetOnlyTree },
  ]
}

describe('GET /api/projects', () => {
  it("defaults to fileType=all when query param is missing", async () => {
    const app = createTestApp(fixture())
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const json = await res.json()
    // 'all' returns every project untouched
    expect(json.data).toHaveLength(2)
    expect(json.data[0].name).toBe('alpha')
    expect(json.data[0].tree).toEqual(fixture()[0].tree)
    expect(json.data[1].name).toBe('beta')
  })

  it("treats unknown fileType values as 'all'", async () => {
    const app = createTestApp(fixture())
    const res = await app.request('/api/projects?fileType=bogus')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(2)
    expect(json.data[1].name).toBe('beta') // asset-only project still present
  })

  it("with fileType=markdown returns only markdown files and drops asset-only projects", async () => {
    const app = createTestApp(fixture())
    const res = await app.request('/api/projects?fileType=markdown')
    expect(res.status).toBe(200)
    const json = await res.json()
    // alpha keeps README.md and docs/guide.md; beta drops out entirely
    expect(json.data).toHaveLength(1)
    expect(json.data[0].name).toBe('alpha')
    const names = json.data[0].tree.map((n: FileNode) => n.name).sort()
    expect(names).toEqual(['README.md', 'docs'])
    const docs = json.data[0].tree.find((n: FileNode) => n.name === 'docs')!
    expect(docs.children.map((c: FileNode) => c.name)).toEqual(['guide.md'])
  })

  it("with fileType=assets returns only non-markdown files and drops markdown-only branches", async () => {
    const app = createTestApp(fixture())
    const res = await app.request('/api/projects?fileType=assets')
    expect(res.status).toBe(200)
    const json = await res.json()
    // alpha keeps docs/screenshot.png; beta keeps logo.svg
    expect(json.data).toHaveLength(2)
    const alpha = json.data.find((p: ProjectInfo) => p.name === 'alpha')!
    expect(alpha.tree.map((n: FileNode) => n.name)).toEqual(['docs'])
    const docs = alpha.tree.find((n: FileNode) => n.name === 'docs')!
    expect(docs.children.map((c: FileNode) => c.name)).toEqual(['screenshot.png'])
    const beta = json.data.find((p: ProjectInfo) => p.name === 'beta')!
    expect(beta.tree.map((n: FileNode) => n.name)).toEqual(['logo.svg'])
  })

  it("with fileType=all behaves identically to no query param", async () => {
    const app = createTestApp(fixture())
    const noParam = await (await app.request('/api/projects')).json()
    const allParam = await (await app.request('/api/projects?fileType=all')).json()
    expect(allParam).toEqual(noParam)
  })
})
