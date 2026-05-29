import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { EXCLUDED_DIRS } from '../src/excluded-paths.js'
import { buildTreePublic } from '../src/discovery.js'
import { createIndexStore } from '../src/search.js'
import { PathResolver } from '../src/path-resolver.js'
import { VibedocsError } from '../src/errors.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-excluded-paths-xlayer-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/**
 * Cross-layer integration test for issue #82.
 *
 * Asserts that the EXCLUDED_DIRS policy propagates uniformly through the
 * three consumer layers (discovery, search, path-resolver). For each entry
 * in the SSOT set we materialise a folder of that name in a temp project,
 * drop a markdown file inside it, and confirm:
 *
 *   1. `discovery.buildTreePublic` hides the folder from the tree.
 *   2. `search.createIndexStore` does not index the markdown inside it.
 *   3. `PathResolver.resolve` rejects the file path with
 *      VibedocsError(forbidden).
 *
 * If a future change adds an entry to EXCLUDED_DIRS, this test
 * automatically exercises the new entry across all three layers — that is
 * the demoable behaviour the SSOT exists for.
 */
describe('EXCLUDED_DIRS — single policy propagates to discovery, search, path-resolver', () => {
  it('every entry in EXCLUDED_DIRS is hidden by discovery, skipped by search, and rejected by path-resolver', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    await mkdir(projectRoot, { recursive: true })

    // Materialise each excluded directory with one markdown file inside it.
    // Also create one regular folder so the tree is not empty.
    await mkdir(path.join(projectRoot, 'docs'), { recursive: true })
    await writeFile(
      path.join(projectRoot, 'docs', 'index.md'),
      '# Index\n\nlegitimate content',
    )

    for (const excluded of EXCLUDED_DIRS) {
      const dir = path.join(projectRoot, excluded)
      await mkdir(dir, { recursive: true })
      await writeFile(
        path.join(dir, 'leak.md'),
        '# leak\n\nthis should never be indexed or served',
      )
    }

    // Layer 1: discovery hides every excluded directory.
    const tree = await buildTreePublic(projectRoot, projectRoot)
    const topLevelNames = new Set(tree.map((n) => n.name))
    for (const excluded of EXCLUDED_DIRS) {
      expect(
        topLevelNames.has(excluded),
        `discovery leaked excluded dir: ${excluded}`,
      ).toBe(false)
    }
    // Sanity: the legitimate 'docs' folder is present.
    expect(topLevelNames.has('docs')).toBe(true)

    // Layer 2: search does not index any markdown file inside an excluded dir.
    const store = createIndexStore({ projectsDir: tmpDir })
    await store.rebuild()
    const hits = store.search('this should never be indexed', 100)
    expect(hits, 'search leaked content from inside an excluded dir').toEqual([])
    // Sanity: the legitimate doc IS indexed.
    expect(store.search('legitimate content', 10).length).toBeGreaterThan(0)

    // Layer 3: path-resolver rejects every excluded directory as a path segment.
    const resolver = new PathResolver({ projectsDir: tmpDir })
    for (const excluded of EXCLUDED_DIRS) {
      // Dotfile-prefixed names (.git, .next, .project-template) are caught by
      // the dotfile layer; non-dot names by the EXCLUDED_DIRS layer. Both must
      // produce VibedocsError(forbidden).
      let thrown: unknown
      try {
        resolver.resolve('proj', `${excluded}/leak.md`)
      } catch (err) {
        thrown = err
      }
      expect(
        thrown instanceof VibedocsError,
        `path-resolver did not throw VibedocsError for ${excluded}`,
      ).toBe(true)
      expect((thrown as VibedocsError).code).toBe('forbidden')
    }
  })
})
