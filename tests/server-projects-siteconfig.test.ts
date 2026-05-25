import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  filterProjects,
  parseFileTypeFilter,
  type FileNode,
  type ProjectInfo,
} from '../src/discovery.js'
import { createSiteConfigCache } from '../src/site-config-cache.js'
import { loadSiteConfig, type SiteConfig } from '../src/site-config.js'

/**
 * Mirror the production /api/projects route, injecting fixture projects and a
 * controllable loadSiteConfig so the test exercises the real cache pipeline
 * without touching the filesystem.
 */
function createTestApp(
  projects: ProjectInfo[],
  loadConfig: (projectPath: string) => Promise<SiteConfig | null>,
) {
  const app = new Hono()
  const cache = createSiteConfigCache({
    loadConfig,
    projectsDir: '/fake/projects',
  })

  app.get('/api/projects', async (c) => {
    const fileType = parseFileTypeFilter(c.req.query('fileType'))
    const filtered = filterProjects(projects, fileType)
    const withConfig = await Promise.all(
      filtered.map(async (p) => ({
        ...p,
        siteConfig: await cache.get(p.name),
      })),
    )
    return c.json({ data: withConfig })
  })

  return { app, cache }
}

const VALID_CONFIG: SiteConfig = {
  name: 'demo',
  domain: 'example.io',
  description: 'observability',
  theme: { tokens: { primary: '#39ff14' } },
  llms: { summary: 'demo', keyDocs: ['README.md'] },
}

function tree(): FileNode[] {
  return [{ name: 'README.md', path: 'README.md', type: 'file' }]
}

describe('GET /api/projects with siteConfig', () => {
  it('attaches siteConfig: null to projects without a .vibedocs.config.ts', async () => {
    const projects: ProjectInfo[] = [{ name: 'vibedocs', hasDocsFolder: false, tree: tree() }]
    const { app } = createTestApp(projects, async () => null)
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].name).toBe('vibedocs')
    expect(json.data[0].siteConfig).toBeNull()
  })

  it('attaches the parsed SiteConfig to projects that have one', async () => {
    const projects: ProjectInfo[] = [{ name: 'demo', hasDocsFolder: false, tree: tree() }]
    const { app } = createTestApp(projects, async () => VALID_CONFIG)
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].name).toBe('demo')
    expect(json.data[0].siteConfig).toEqual(VALID_CONFIG)
  })

  it('passes through all existing fields (name, hasDocsFolder, tree) untouched', async () => {
    const projects: ProjectInfo[] = [
      { name: 'demo', hasDocsFolder: true, tree: tree() },
    ]
    const { app } = createTestApp(projects, async () => null)
    const res = await app.request('/api/projects')
    const json = await res.json()
    expect(json.data[0]).toMatchObject({
      name: 'demo',
      hasDocsFolder: true,
      tree: tree(),
      siteConfig: null,
    })
  })
})

describe('site-config cache behaviour exposed by /api/projects', () => {
  it('caches loaded configs and only calls loadConfig once per project across requests', async () => {
    const projects: ProjectInfo[] = [{ name: 'demo', hasDocsFolder: false, tree: tree() }]
    let calls = 0
    const { app } = createTestApp(projects, async () => {
      calls++
      return VALID_CONFIG
    })

    await app.request('/api/projects')
    await app.request('/api/projects')
    await app.request('/api/projects')

    expect(calls).toBe(1)
  })

  it('cache.invalidate(name) forces a fresh load on the next request, returning updated config', async () => {
    const projects: ProjectInfo[] = [{ name: 'demo', hasDocsFolder: false, tree: tree() }]
    let returned: SiteConfig = { ...VALID_CONFIG, domain: 'v1.example.io' }
    const { app, cache } = createTestApp(projects, async () => returned)

    const first = await (await app.request('/api/projects')).json()
    expect(first.data[0].siteConfig.domain).toBe('v1.example.io')

    // Simulate the user editing .vibedocs.config.ts on disk and bumping the version.
    returned = { ...VALID_CONFIG, domain: 'v2.example.io' }

    // Without invalidation we hit the cache.
    const cached = await (await app.request('/api/projects')).json()
    expect(cached.data[0].siteConfig.domain).toBe('v1.example.io')

    // Invalidation triggers a fresh load.
    cache.invalidate('demo')
    const refreshed = await (await app.request('/api/projects')).json()
    expect(refreshed.data[0].siteConfig.domain).toBe('v2.example.io')
  })

  it('invalidateFromPath maps a .vibedocs.config.ts absolute path to the right project', async () => {
    const projects: ProjectInfo[] = [
      { name: 'demo', hasDocsFolder: false, tree: tree() },
      { name: 'vibedocs', hasDocsFolder: false, tree: tree() },
    ]
    let demoVersion = 'v1'
    const { app, cache } = createTestApp(projects, async (projectPath) => {
      // Each call returns the current version embedded in the name field — that
      // way the test can assert which project actually re-loaded.
      if (projectPath.endsWith('/demo')) return { ...VALID_CONFIG, name: demoVersion }
      return null
    })

    const before = await (await app.request('/api/projects')).json()
    const demo = before.data.find((p: ProjectInfo) => p.name === 'demo')!
    expect((demo as any).siteConfig.name).toBe('v1')

    demoVersion = 'v2'
    // Chokidar would call this with the absolute path of the changed file.
    cache.invalidateFromPath('/fake/projects/demo/.vibedocs.config.ts')

    const after = await (await app.request('/api/projects')).json()
    const demoAfter = after.data.find((p: ProjectInfo) => p.name === 'demo')!
    expect((demoAfter as any).siteConfig.name).toBe('v2')
  })

  it('invalidateFromPath ignores paths outside any project (defensive: never throws)', async () => {
    const projects: ProjectInfo[] = [{ name: 'demo', hasDocsFolder: false, tree: tree() }]
    const { cache } = createTestApp(projects, async () => null)
    // Should be a silent no-op rather than a throw — chokidar should never
    // crash the watcher because of a path it can't classify.
    expect(() => cache.invalidateFromPath('/some/other/place/.vibedocs.config.ts')).not.toThrow()
    expect(() => cache.invalidateFromPath('/fake/projects/demo/README.md')).not.toThrow()
  })

  it('treats a load failure as null and re-attempts on next invalidation', async () => {
    const projects: ProjectInfo[] = [{ name: 'demo', hasDocsFolder: false, tree: tree() }]
    let mode: 'throw' | 'ok' = 'throw'
    const { app, cache } = createTestApp(projects, async () => {
      if (mode === 'throw') throw new Error('boom')
      return VALID_CONFIG
    })

    const first = await (await app.request('/api/projects')).json()
    // Failed load → siteConfig is null (route stays alive even when a single
    // config is broken; matches the "default behaviour unchanged" guarantee).
    expect(first.data[0].siteConfig).toBeNull()

    mode = 'ok'
    cache.invalidate('demo')
    const second = await (await app.request('/api/projects')).json()
    expect(second.data[0].siteConfig).toEqual(VALID_CONFIG)
  })
})

/**
 * Round-trip integration: real loadSiteConfig wired to the cache, real
 * fixture project trees on disk. Covers the verbatim acceptance criteria:
 *   - vibedocs (no config file) → siteConfig: null
 *   - fixture project with .vibedocs.config.ts → parsed SiteConfig
 *   - editing the fixture mid-server + invalidating triggers a re-load that
 *     returns the updated config
 */
describe('GET /api/projects with real loadSiteConfig + on-disk fixtures', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-projects-siteconfig-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function buildApp(projects: ProjectInfo[]) {
    const cache = createSiteConfigCache({
      loadConfig: loadSiteConfig,
      projectsDir: tmpDir,
    })
    const app = new Hono()
    app.get('/api/projects', async (c) => {
      const fileType = parseFileTypeFilter(c.req.query('fileType'))
      const filtered = filterProjects(projects, fileType)
      const withConfig = await Promise.all(
        filtered.map(async (p) => ({
          ...p,
          siteConfig: await cache.get(p.name),
        })),
      )
      return c.json({ data: withConfig })
    })
    return { app, cache }
  }

  it('returns null siteConfig for a project without a .vibedocs.config.ts (e.g. vibedocs itself)', async () => {
    // Create the project directory but no config file — mirrors how vibedocs
    // itself ships in production.
    await mkdir(path.join(tmpDir, 'vibedocs'), { recursive: true })
    const projects: ProjectInfo[] = [
      { name: 'vibedocs', hasDocsFolder: false, tree: tree() },
    ]
    const { app } = buildApp(projects)
    const json = await (await app.request('/api/projects')).json()
    expect(json.data[0].name).toBe('vibedocs')
    expect(json.data[0].siteConfig).toBeNull()
  })

  it('returns the parsed config for a project that ships a .vibedocs.config.ts', async () => {
    const projectDir = path.join(tmpDir, 'demo')
    await mkdir(projectDir, { recursive: true })
    const source = `
      import { defineSite } from 'vibedocs/config'
      export default defineSite({
        name: 'demo',
        domain: 'example.io',
        description: 'observability',
        theme: { tokens: { primary: '#39ff14' } },
        llms: { summary: 'demo is obs', keyDocs: ['README.md'] },
      })
    `
    await writeFile(path.join(projectDir, '.vibedocs.config.ts'), source, 'utf8')

    const projects: ProjectInfo[] = [
      { name: 'demo', hasDocsFolder: false, tree: tree() },
    ]
    const { app } = buildApp(projects)
    const json = await (await app.request('/api/projects')).json()
    expect(json.data[0].name).toBe('demo')
    expect(json.data[0].siteConfig).not.toBeNull()
    expect(json.data[0].siteConfig.name).toBe('demo')
    expect(json.data[0].siteConfig.domain).toBe('example.io')
    expect(json.data[0].siteConfig.theme.tokens.primary).toBe('#39ff14')
  })

  it('editing the fixture .vibedocs.config.ts + invalidating returns the updated config on next request', async () => {
    const projectDir = path.join(tmpDir, 'demo')
    await mkdir(projectDir, { recursive: true })
    const configPath = path.join(projectDir, '.vibedocs.config.ts')

    const writeConfig = async (domain: string) => {
      const source = `
        export default {
          name: 'demo',
          domain: '${domain}',
          description: 'observability',
          theme: { tokens: {} },
          llms: { summary: 's', keyDocs: [] },
        }
      `
      await writeFile(configPath, source, 'utf8')
    }

    await writeConfig('v1.example.io')
    const projects: ProjectInfo[] = [
      { name: 'demo', hasDocsFolder: false, tree: tree() },
    ]
    const { app, cache } = buildApp(projects)

    const first = await (await app.request('/api/projects')).json()
    expect(first.data[0].siteConfig.domain).toBe('v1.example.io')

    // Author edits the config on disk.
    await writeConfig('v2.example.io')

    // Without an invalidation event we still see the cached v1 — proving the
    // cache is actually doing its job.
    const cached = await (await app.request('/api/projects')).json()
    expect(cached.data[0].siteConfig.domain).toBe('v1.example.io')

    // Simulate the chokidar event for `.vibedocs.config.ts`.
    cache.invalidateFromPath(configPath)

    const refreshed = await (await app.request('/api/projects')).json()
    expect(refreshed.data[0].siteConfig.domain).toBe('v2.example.io')
  })
})
