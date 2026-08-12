import type { RunMeta, RunStatus } from "@shared/agent-run-types"

/** Statuses meaning the run has finished; everything else is work in flight. */
export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = ["done", "failed", "stopped"]

/**
 * How many runs the rail badge should count.
 *
 * Terminal runs are excluded so the badge answers "how much is happening now?"
 * rather than "how many runs exist?" — the latter only ever grows.
 */
export function activeRunCount(runs: readonly RunMeta[]): number {
  return runs.filter((r) => !RUN_TERMINAL_STATUSES.includes(r.status)).length
}
