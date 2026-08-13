import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { discoverAcrossRoots, discoverProjects } from '../src/discovery.js'

/**
 * Discovery over more than one root (#113).
 *
 * The single-root walk is unchanged and still does all the work; this only adds
 * "run it per root and merge", plus the naming rule from `project-roots.ts` for the
 * one case where merging is not obvious — two roots offering the same name.
 */
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-multiroot-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

/** A project with one markdown file, so discovery keeps it. */
async function project(root: string, name: string, file = 'index.md') {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, file), `# ${name}`)
  return dir
}

async function root(name: string) {
  const dir = path.join(tmp, name)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('discoverAcrossRoots', () => {
  it('returns the same thing as the single-root walk when given one root', async () => {
    // The installed base is single-root. Anything that changes here is a
    // regression, not a feature.
    const only = await root('only')
    await project(only, 'alpha')
    await project(only, 'beta')

    expect(await discoverAcrossRoots([only])).toEqual(await discoverProjects(only))
  })

  it('merges projects from every root', async () => {
    const dev = await root('Development')
    const docs = await root('Documents')
    await project(dev, 'app')
    await project(docs, 'notes')

    const found = await discoverAcrossRoots([dev, docs])
    expect(found.map((p) => p.name).sort()).toEqual(['app', 'notes'])
  })

  it('keeps both projects when two roots offer the same name', async () => {
    // The whole point: a name clash must not silently drop one of them.
    const dev = await root('Development')
    const docs = await root('Documents')
    await project(dev, 'guide')
    await project(docs, 'guide')

    const found = await discoverAcrossRoots([dev, docs])
    expect(found.map((p) => p.name)).toEqual(['guide', 'guide~Documents'])
  })

  it('leaves the first root\'s name bare, so adding a root renames nothing', async () => {
    const dev = await root('Development')
    const docs = await root('Documents')
    await project(dev, 'guide')

    const before = await discoverAcrossRoots([dev])
    await project(docs, 'guide')
    const after = await discoverAcrossRoots([dev, docs])

    expect(before[0].name).toBe('guide')
    expect(after[0].name).toBe('guide')
  })

  it('carries each project\'s own tree, not the other root\'s', async () => {
    const dev = await root('Development')
    const docs = await root('Documents')
    await project(dev, 'guide', 'from-dev.md')
    await project(docs, 'guide', 'from-docs.md')

    const found = await discoverAcrossRoots([dev, docs])
    const names = (p: string) => found.find((x) => x.name === p)!.tree.map((n) => n.name)
    expect(names('guide')).toEqual(['from-dev.md'])
    expect(names('guide~Documents')).toEqual(['from-docs.md'])
  })

  it('skips a root that does not exist rather than failing the others', async () => {
    // A stale entry in an exported env var must not take the whole server down.
    const dev = await root('Development')
    await project(dev, 'app')

    const found = await discoverAcrossRoots([dev, path.join(tmp, 'gone')])
    expect(found.map((p) => p.name)).toEqual(['app'])
  })

  it('orders roots as configured, and projects within a root by name', async () => {
    // Stable ordering keeps the sidebar from reshuffling between restarts.
    const second = await root('bbb')
    const first = await root('aaa')
    await project(first, 'zeta')
    await project(first, 'alpha')
    await project(second, 'mid')

    const found = await discoverAcrossRoots([second, first])
    expect(found.map((p) => p.name)).toEqual(['mid', 'alpha', 'zeta'])
  })
})
