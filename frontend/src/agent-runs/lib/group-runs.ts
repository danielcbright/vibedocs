import type { RunMeta } from "@shared/agent-run-types"
import { RUN_TERMINAL_STATUSES } from "./run-status"

export type RunGrouping = "status" | "project" | "flat"
export type RunSort = "newest" | "oldest"

export const UNGROUPED_LABEL = "Ungrouped"

export interface RunGroup {
  label: string
  runs: RunMeta[]
}

function sorted(runs: readonly RunMeta[], sort: RunSort): RunMeta[] {
  const copy = [...runs]
  copy.sort((a, b) => (sort === "newest" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt))
  return copy
}

/**
 * Arrange runs for the rail.
 *
 * - `status` (default): active above, finished below — what you want while work
 *   is in flight.
 * - `project`: one group per project, so an all-projects rail stays readable.
 *   Runs with no project fall into a single trailing "Ungrouped" bucket rather
 *   than being hidden, because a run that forgot to declare a project is
 *   exactly the one you go looking for.
 * - `flat`: no grouping, just the sort.
 *
 * Empty groups are never emitted.
 */
export function groupRuns(
  runs: readonly RunMeta[],
  grouping: RunGrouping,
  sort: RunSort,
): RunGroup[] {
  if (grouping === "flat") {
    const all = sorted(runs, sort)
    return all.length ? [{ label: "All runs", runs: all }] : []
  }

  if (grouping === "project") {
    const byProject = new Map<string, RunMeta[]>()
    for (const run of runs) {
      const key = run.project?.trim() || UNGROUPED_LABEL
      const bucket = byProject.get(key)
      if (bucket) bucket.push(run)
      else byProject.set(key, [run])
    }
    const named = [...byProject.keys()].filter((k) => k !== UNGROUPED_LABEL).sort((a, b) => a.localeCompare(b))
    const keys = byProject.has(UNGROUPED_LABEL) ? [...named, UNGROUPED_LABEL] : named
    return keys.map((label) => ({ label, runs: sorted(byProject.get(label)!, sort) }))
  }

  const active = sorted(runs.filter((r) => !RUN_TERMINAL_STATUSES.includes(r.status)), sort)
  const done = sorted(runs.filter((r) => RUN_TERMINAL_STATUSES.includes(r.status)), sort)
  const groups: RunGroup[] = []
  if (active.length) groups.push({ label: "Active", runs: active })
  if (done.length) groups.push({ label: "Done", runs: done })
  return groups
}
