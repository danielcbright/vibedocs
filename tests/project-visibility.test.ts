import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, mkdtemp, writeFile, realpath } from 'fs/promises'
import path from 'path'
import os from 'os'
import { projectVisibility, NO_RULES } from '../src/shared/project-visibility.js'
import { createProjectVisibility, isLinkedWorktree, hiddenProjectDirs } from '../src/project-visibility.js'

/**
 * Which projects are hidden (ADR-0003): not listed, watched or searched, still
 * served. One rule, shared with the Settings view so its preview is the server's
 * answer.
 */
describe('projectVisibility — the rule', () => {
  const root = '/r'
  const dir = '/r/proj'

  it('shows an ordinary project', () => {
    expect(projectVisibility(dir, root, false, NO_RULES)).toEqual({ hidden: false, reason: null })
  })

  it('hides a linked worktree by default', () => {
    expect(projectVisibility(dir, root, true, NO_RULES)).toEqual({ hidden: true, reason: 'worktree' })
  })

  it('shows worktrees in a root that opted out', () => {
    expect(projectVisibility(dir, root, true, { ...NO_RULES, showWorktrees: [root] })).toEqual({ hidden: false, reason: null })
  })

  it('lets `show` override the worktree rule for one project', () => {
    expect(projectVisibility(dir, root, true, { ...NO_RULES, show: [dir] })).toEqual({ hidden: false, reason: null })
  })

  it('lets `hide` override everything, including `show`', () => {
    expect(projectVisibility(dir, root, false, { ...NO_RULES, hide: [dir] })).toEqual({ hidden: true, reason: 'manual' })
    expect(projectVisibility(dir, root, false, { ...NO_RULES, hide: [dir], show: [dir] })).toEqual({ hidden: true, reason: 'manual' })
  })
})

describe('isLinkedWorktree / createProjectVisibility — on disk', () => {
  let tmp: string
  let root: string

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vibedocs-visibility-')))
    root = path.join(tmp, 'root')
    await mkdir(path.join(root, 'repo', '.git'), { recursive: true })
    await mkdir(path.join(root, 'repo-wt'), { recursive: true })
    await writeFile(path.join(root, 'repo-wt', '.git'), `gitdir: ${root}/repo/.git/worktrees/repo-wt\n`)
    await mkdir(path.join(root, 'sub'), { recursive: true })
    await writeFile(path.join(root, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n')
    await mkdir(path.join(root, 'plain'), { recursive: true })
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('knows a linked worktree by its .git file, and nothing else', () => {
    expect(isLinkedWorktree(path.join(root, 'repo-wt'))).toBe(true)
    // A repository's own .git is a directory.
    expect(isLinkedWorktree(path.join(root, 'repo'))).toBe(false)
    // A submodule also has a .git file, pointing at modules/, not worktrees/.
    expect(isLinkedWorktree(path.join(root, 'sub'))).toBe(false)
    expect(isLinkedWorktree(path.join(root, 'plain'))).toBe(false)
  })

  it('applies the rule only to direct children of a configured root', () => {
    const v = createProjectVisibility({ roots: [root], rules: NO_RULES })
    expect(v.isHidden(path.join(root, 'repo-wt'))).toBe(true)
    expect(v.isHidden(path.join(root, 'repo'))).toBe(false)
    // Not a project: deeper than a root's children, or under no root.
    expect(v.isHidden(path.join(root, 'repo-wt', 'docs'))).toBe(false)
    expect(v.isHidden(path.join(tmp, 'elsewhere'))).toBe(false)
  })

  it('remembers the answer briefly, so a walk does not stat .git once per file', async () => {
    let probes = 0
    let t = 0
    const v = createProjectVisibility({
      roots: [root],
      rules: NO_RULES,
      isWorktree: () => {
        probes++
        return false
      },
      ttlMs: 1000,
      now: () => t,
    })
    for (let i = 0; i < 50; i++) v.isHidden(path.join(root, 'plain'))
    expect(probes).toBe(1)
    t = 1001
    v.isHidden(path.join(root, 'plain'))
    expect(probes).toBe(2)
  })

  it('lists the hidden projects under each root', () => {
    const v = createProjectVisibility({ roots: [root], rules: { ...NO_RULES, hide: [path.join(root, 'plain')] } })
    expect(hiddenProjectDirs([root], v).sort()).toEqual([path.join(root, 'plain'), path.join(root, 'repo-wt')])
  })
})
