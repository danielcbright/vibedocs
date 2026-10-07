/**
 * Which projects are hidden — not listed, watched or searched, but still served
 * (ADR-0003). Pure and shared: the server decides with it, and the Settings view
 * previews a selection with it, so the two cannot disagree.
 *
 * Paths are compared as given; both sides pass absolute, normalised paths.
 */

export interface VisibilityRules {
  /** Project directories hidden by hand. Wins over everything. */
  hide: readonly string[]
  /** Project directories shown by hand, overriding the worktree rule. */
  show: readonly string[]
  /** Roots whose linked git worktrees are listed like any other project. */
  showWorktrees: readonly string[]
}

export const NO_RULES: VisibilityRules = { hide: [], show: [], showWorktrees: [] }

export interface Visibility {
  hidden: boolean
  /** Why it is hidden; null when shown. */
  reason: 'manual' | 'worktree' | null
}

export function projectVisibility(
  projectDir: string,
  root: string,
  isWorktree: boolean,
  rules: VisibilityRules,
): Visibility {
  if (rules.hide.includes(projectDir)) return { hidden: true, reason: 'manual' }
  if (rules.show.includes(projectDir)) return { hidden: false, reason: null }
  if (isWorktree && !rules.showWorktrees.includes(root)) return { hidden: true, reason: 'worktree' }
  return { hidden: false, reason: null }
}

export function hasRules(rules: VisibilityRules): boolean {
  return rules.hide.length + rules.show.length + rules.showWorktrees.length > 0
}
