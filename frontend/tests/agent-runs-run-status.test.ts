import { describe, it, expect } from "vitest"
import {
  RUN_TERMINAL_STATUSES, activeRunCount, isStopPending, isTerminalStatus, isUnresolvedStatus,
} from "@/agent-runs/lib/run-status"
import type { RunMeta, RunStatus } from "@shared/agent-run-types"

const meta = (status: RunStatus, stopRequested?: boolean): RunMeta => ({
  id: "r", title: "r", status, links: [], format: "cursor-stream-json",
  createdAt: 1, updatedAt: 1, eventCount: 0, recCount: 0, adapterVersion: 1,
  ...(stopRequested === undefined ? {} : { stopRequested }),
})

describe("terminal vs unresolved", () => {
  it("treats stopped as terminal, so no action is offered on a dead agent", () => {
    // Offering Stop on a stopped run offers something that cannot happen.
    expect(isTerminalStatus("stopped")).toBe(true)
    expect(RUN_TERMINAL_STATUSES).toContain("stopped")
  })

  it("marks only stopped as unresolved", () => {
    expect(isUnresolvedStatus("stopped")).toBe(true)
    for (const s of ["done", "failed", "running", "idle", "blocked", "waiting"] as RunStatus[]) {
      expect(isUnresolvedStatus(s), s).toBe(false)
    }
  })

  it("keeps a stopped run out of the active badge count", () => {
    // A badge that never returns to zero stops being a signal.
    expect(activeRunCount([meta("running"), meta("stopped"), meta("done")])).toBe(1)
  })
})

describe("isStopPending", () => {
  it("is true while a stop is queued on a live run", () => {
    expect(isStopPending(meta("running", true))).toBe(true)
    expect(isStopPending(meta("idle", true))).toBe(true)
  })

  it("is false once the run has finished, however it finished", () => {
    // stopRequested survives in metadata after the run ends. Rendering it as
    // still-pending would leave a permanent "waiting" hint on a closed run.
    expect(isStopPending(meta("stopped", true))).toBe(false)
    expect(isStopPending(meta("failed", true))).toBe(false)
    expect(isStopPending(meta("done", true))).toBe(false)
  })

  it("is false when no stop was asked for", () => {
    expect(isStopPending(meta("running"))).toBe(false)
    expect(isStopPending(meta("running", false))).toBe(false)
  })
})
