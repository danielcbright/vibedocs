/**
 * The server side of project visibility (ADR-0003): the shared rule plus the one
 * filesystem question it needs, "is this a linked git worktree?".
 *
 * Discovery, the search walk and incremental index updates all ask through one
 * instance, so they cannot disagree about what is hidden. The watcher asks once,
 * at boot (`hiddenProjectDirs`). Naming never consults any of this: hiding a
 * project must not rename another one.
 */
import path from 'path'
import { lstatSync, readdirSync, readFileSync } from 'fs'
import { projectVisibility, type Visibility, type VisibilityRules } from './shared/project-visibility.js'

/**
 * A linked worktree's `.git` is a file whose `gitdir:` points into the main
 * repository's `worktrees/` directory. A submodule's `.git` is also a file, but
 * points into `modules/`, and a repository's own `.git` is a directory.
 */
export function isLinkedWorktree(projectDir: string): boolean {
  const dotGit = path.join(projectDir, '.git')
  try {
    if (!lstatSync(dotGit).isFile()) return false
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf-8'))?.[1]?.trim()
    return gitdir !== undefined && gitdir.split(/[\\/]/).includes('worktrees')
  } catch {
    return false
  }
}

export interface ProjectVisibility {
  /** True for a hidden project. False for a shown one, or anything that is not a project. */
  isHidden(projectDir: string): boolean
  visibility(projectDir: string): Visibility
  /** Ask the filesystem again next time — the project's `.git` just changed. */
  forget(projectDir: string): void
}

export interface CreateProjectVisibilityOptions {
  roots: readonly string[]
  rules: VisibilityRules
  isWorktree?: (projectDir: string) => boolean
  /**
   * How long an answer is reused. The search walk asks once per file, so without
   * this a 7,000-file walk would read `.git` 7,000 times; short enough that a
   * worktree created a moment ago is noticed on the next request.
   */
  ttlMs?: number
  now?: () => number
}

export function createProjectVisibility(opts: CreateProjectVisibilityOptions): ProjectVisibility {
  const { roots, rules, isWorktree = isLinkedWorktree, ttlMs = 2000, now = Date.now } = opts
  const cache = new Map<string, { at: number; worktree: boolean }>()

  function worktree(projectDir: string): boolean {
    const hit = cache.get(projectDir)
    if (hit !== undefined && now() - hit.at <= ttlMs) return hit.worktree
    const answer = isWorktree(projectDir)
    cache.set(projectDir, { at: now(), worktree: answer })
    return answer
  }

  function visibility(projectDir: string): Visibility {
    const root = path.dirname(projectDir)
    if (!roots.includes(root)) return { hidden: false, reason: null }
    return projectVisibility(projectDir, root, worktree(projectDir), rules)
  }

  return {
    visibility,
    isHidden: (projectDir) => visibility(projectDir).hidden,
    forget: (projectDir) => {
      cache.delete(projectDir)
    },
  }
}

/** Every hidden project under the roots right now. The watcher takes this at boot. */
export function hiddenProjectDirs(roots: readonly string[], visibility: ProjectVisibility): string[] {
  const hidden: string[] = []
  for (const root of roots) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      const dir = path.join(root, name)
      if (visibility.isHidden(dir)) hidden.push(dir)
    }
  }
  return hidden
}
