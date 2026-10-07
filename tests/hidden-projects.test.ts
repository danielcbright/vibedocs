import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { Hono } from 'hono'
import { createAppState } from '../src/app-state.js'
import { discoverAcrossRoots } from '../src/discovery.js'
import { createIndexStore, resolveIndexKey } from '../src/search.js'
import { isIgnoredWatchPath, resolveIgnorePrefixes } from '../src/adapters/chokidar-fs-event-source.js'
import { createProjectVisibility } from '../src/project-visibility.js'
import { NO_RULES, type VisibilityRules } from '../src/shared/project-visibility.js'
import { PathResolver } from '../src/path-resolver.js'
import { MARKDOWN_EXTENSIONS } from '../src/markdown-paths.js'
import { registerOpenRoute } from '../src/open-route.js'
import { registerProjectTreeRoute } from '../src/server-routes.js'
import { registerErrorHandler } from '../src/errors.js'
import { registerStaticRoutes } from '../src/static-files.js'
import { parseUploadAuthConfig } from '../src/upload-auth.js'
import type { FsEventSource } from '../src/ports/fs-event-source.js'

/**
 * Hidden projects (ADR-0003): not listed, not watched, not indexed — and still
 * served. Every layer that decides "is this in?" is asked here, because the bug a
 * disagreement produces is silent: a search hit for a project the sidebar does not
 * have, or a watcher holding the very trees hiding was meant to drop.
 */
let tmp: string
let one: string
let two: string

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-hidden-')))
  one = path.join(tmp, 'RootOne')
  two = path.join(tmp, 'RootTwo')
  const files: Record<string, string> = {
    [path.join(one, 'repo', 'README.md')]: '# Repo zebracorn',
    [path.join(one, 'repo-wt', 'README.md')]: '# Worktree zebracorn',
    [path.join(one, 'old', 'README.md')]: '# Old zebracorn',
    [path.join(two, 'repo-wt', 'README.md')]: '# Second root zebracorn',
  }
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  }
  await mkdir(path.join(one, 'repo', '.git'), { recursive: true })
  await writeFile(path.join(one, 'repo-wt', '.git'), `gitdir: ${one}/repo/.git/worktrees/repo-wt\n`)
  await writeFile(path.join(two, 'repo-wt', '.git'), `gitdir: ${one}/repo/.git/worktrees/repo-wt2\n`)
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const visibility = (rules: VisibilityRules = NO_RULES) => createProjectVisibility({ roots: [one, two], rules })

describe('discovery', () => {
  it('leaves hidden projects out of the list: worktrees by default, and anything hidden by hand', async () => {
    const v = visibility({ ...NO_RULES, hide: [path.join(one, 'old')] })
    const names = (await discoverAcrossRoots([one, two], v.isHidden)).map((p) => p.name)
    expect(names).toEqual(['repo'])
  })

  it('lists worktrees in a root that opted out, and a worktree shown by hand', async () => {
    const v = visibility({ ...NO_RULES, showWorktrees: [two], show: [path.join(one, 'repo-wt')] })
    const names = (await discoverAcrossRoots([one, two], v.isHidden)).map((p) => p.name)
    expect(names).toEqual(['old', 'repo', 'repo-wt', 'repo-wt~RootTwo'])
  })

  it('never renames a project because another is hidden', async () => {
    // RootOne's repo-wt is hidden, and RootTwo's is shown. RootTwo's keeps the
    // qualified name it has when both are visible: names are routing keys.
    const v = visibility({ ...NO_RULES, showWorktrees: [two] })
    const names = (await discoverAcrossRoots([one, two], v.isHidden)).map((p) => p.name)
    expect(names).toContain('repo-wt~RootTwo')
    expect(names).not.toContain('repo-wt')
  })
})

describe('search', () => {
  it('does not index a hidden project, on the full walk or on a single-file update', async () => {
    const v = visibility()
    const store = createIndexStore({ roots: [one, two], isHidden: v.isHidden })
    await store.rebuild()
    const projects = () => store.search('zebracorn').map((r) => r.project).sort()
    expect(projects()).toEqual(['old', 'repo'])

    await writeFile(path.join(one, 'repo-wt', 'NEW.md'), '# zebracorn again')
    await store.updateFile(path.join(one, 'repo-wt', 'NEW.md'))
    expect(projects()).toEqual(['old', 'repo'])
  })

  it('agrees through resolveIndexKey, the one place index scope is decided', () => {
    const v = visibility()
    expect(resolveIndexKey([one, two], path.join(one, 'repo-wt', 'README.md'), v.isHidden)).toBeNull()
    expect(resolveIndexKey([one, two], path.join(one, 'repo', 'README.md'), v.isHidden)).not.toBeNull()
  })
})

describe('watcher', () => {
  it('ignores everything under a hidden project, and nothing beside it', () => {
    const prefixes = resolveIgnorePrefixes([one, two])
    const hidden = [path.join(one, 'repo-wt')]
    expect(isIgnoredWatchPath(path.join(one, 'repo-wt'), true, prefixes, hidden)).toBe(true)
    expect(isIgnoredWatchPath(path.join(one, 'repo-wt', 'README.md'), false, prefixes, hidden)).toBe(true)
    expect(isIgnoredWatchPath(path.join(one, 'repo-wt-other', 'README.md'), false, prefixes, hidden)).toBe(false)
    expect(isIgnoredWatchPath(path.join(one, 'repo', 'README.md'), false, prefixes, hidden)).toBe(false)
  })
})

describe('AppState', () => {
  it('lists projects without the hidden ones', async () => {
    const source: FsEventSource = { subscribe: () => {}, close: async () => {} }
    const state = createAppState({
      roots: [one, two],
      fsEventSource: source,
      clientChannel: { broadcast: () => {}, close: () => {} },
      uploadAuth: parseUploadAuthConfig({}),
      visibility: visibility(),
    })
    expect((await state.listProjects()).map((p) => p.name)).toEqual(['old', 'repo'])
  })
})

describe('still served', () => {
  it('opens a doc in a hidden worktree by its path', async () => {
    const app = new Hono()
    registerOpenRoute(app, {
      roots: [one, two],
      docResolver: new PathResolver({ roots: [one, two], requireExtensions: MARKDOWN_EXTENSIONS }),
    })
    const res = await app.request(`/open?path=${encodeURIComponent(path.join(one, 'repo-wt', 'README.md'))}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/#repo-wt/README.md')
  })
})

describe('GET /api/projects/:project/tree — the sidebar for a hidden project you are on', () => {
  async function app() {
    const a = new Hono()
    registerErrorHandler(a)
    registerProjectTreeRoute(a, {
      assetResolver: new PathResolver({ roots: [one, two] }),
      isHidden: visibility().isHidden,
    })
    const dist = path.join(tmp, 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>spa</title>')
    registerStaticRoutes(a, dist)
    return a
  }

  it('returns a hidden project\'s tree, flagged hidden', async () => {
    const res = await (await app()).request('/api/projects/repo-wt/tree')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toMatchObject({ name: 'repo-wt', hidden: true })
    expect(data.tree.map((n: { name: string }) => n.name)).toEqual(['README.md'])
  })

  it('returns a shown project too, flagged not hidden, and a qualified name', async () => {
    const a = await app()
    expect((await (await a.request('/api/projects/repo/tree')).json()).data.hidden).toBe(false)
    expect((await (await a.request('/api/projects/repo-wt~RootTwo/tree')).json()).data).toMatchObject({ name: 'repo-wt~RootTwo', hidden: true })
  })

  it('answers JSON errors, not the SPA fallback: unknown 404, dot-directory 403', async () => {
    const a = await app()
    const unknown = await a.request('/api/projects/ghost/tree')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toMatch(/^application\/json/)
    // A root that is itself a git checkout has a real `.git` child to find.
    await mkdir(path.join(one, '.git'), { recursive: true })
    expect((await a.request('/api/projects/.git/tree')).status).toBe(403)
  })
})
