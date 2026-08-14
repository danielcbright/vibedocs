import type { RunMeta, RunStatus } from "@shared/agent-run-types"

/**
 * Statuses meaning the run has finished; everything else is work in flight.
 *
 * The single definition. `RunActions` used to carry its own copy inline, which
 * meant moving a status between categories silently changed grouping while
 * leaving the Stop button's idea of "finished" behind.
 */
export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = ["done", "failed", "stopped"]

/**
 * Terminal, but not a clean finish — the run ended without its work landing.
 *
 * Grouped apart from `done`/`failed` because a stopped run is a loose end
 * someone has to pick up, and rendering it beside completed runs makes it read as
 * finished. It stays *terminal* for actions: the agent is gone, so offering Stop
 * again would be offering something that cannot happen.
 */
export const RUN_UNRESOLVED_STATUSES: readonly RunStatus[] = ["stopped"]

export function isTerminalStatus(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.includes(status)
}

export function isUnresolvedStatus(status: RunStatus): boolean {
  return RUN_UNRESOLVED_STATUSES.includes(status)
}

/**
 * How many runs the rail badge should count.
 *
 * Terminal runs are excluded so the badge answers "how much is happening now?"
 * rather than "how many runs exist?" — the latter only ever grows. A stopped run
 * is deliberately not counted: it needs attention, but nothing is running, and a
 * badge that never returns to zero stops being a signal.
 */
export function activeRunCount(runs: readonly RunMeta[]): number {
  return runs.filter((r) => !isTerminalStatus(r.status)).length
}

/**
 * Is a stop queued but not yet honoured?
 *
 * Deliberately derived rather than a `RunStatus` of its own. The status
 * vocabulary belongs to the client and describes what the agent is doing;
 * `stopRequested` is server-side queue state. Keeping them separate means a
 * client never has to know about our queue to report its own status.
 */
export function isStopPending(run: Pick<RunMeta, "status" | "stopRequested">): boolean {
  return run.stopRequested === true && !isTerminalStatus(run.status)
}
