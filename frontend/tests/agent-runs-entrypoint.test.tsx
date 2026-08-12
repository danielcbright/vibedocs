import { describe, it, expect } from "vitest"
import { activeRunCount } from "@/agent-runs/lib/run-status"
import type { RunMeta } from "@shared/agent-run-types"

function run(status: RunMeta["status"]): RunMeta {
  return {
    id: status, title: status, status, links: [], format: "cursor-stream-json",
    createdAt: 1, updatedAt: 1, eventCount: 0, recCount: 0, adapterVersion: 1,
  }
}

describe("activeRunCount", () => {
  it("counts only non-terminal runs", () => {
    // done/failed/stopped are finished; the badge should show work in flight.
    expect(activeRunCount([run("running"), run("running"), run("done")])).toBe(2)
    expect(activeRunCount([run("idle"), run("blocked"), run("waiting")])).toBe(3)
    expect(activeRunCount([run("done"), run("failed"), run("stopped")])).toBe(0)
  })

  it("is zero for an empty list", () => {
    expect(activeRunCount([])).toBe(0)
  })
})
