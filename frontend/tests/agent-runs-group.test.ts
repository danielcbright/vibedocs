import { describe, it, expect } from "vitest"
import { groupRuns, UNGROUPED_LABEL } from "@/agent-runs/lib/group-runs"
import type { RunMeta, RunStatus } from "@shared/agent-run-types"

const run = (id: string, status: RunStatus, updatedAt: number, project?: string): RunMeta => ({
  id, title: id, status, links: [], format: "cursor-stream-json",
  createdAt: 1, updatedAt, eventCount: 0, recCount: 0, adapterVersion: 1,
  ...(project ? { project } : {}),
})

const runs = [
  run("a", "running", 300, "web"),
  run("b", "done", 200, "api"),
  run("c", "running", 100, "web"),
  run("d", "failed", 400),
]

const shape = (g: ReturnType<typeof groupRuns>) => g.map((x) => [x.label, x.runs.map((r) => r.id)])

describe("groupRuns", () => {
  it("groups by status with active first, newest within each", () => {
    expect(shape(groupRuns(runs, "status", "newest"))).toEqual([
      ["Active", ["a", "c"]],
      ["Done", ["d", "b"]],
    ])
  })

  it("groups by project, alphabetically, with unprojected runs last", () => {
    expect(shape(groupRuns(runs, "project", "newest"))).toEqual([
      ["api", ["b"]],
      ["web", ["a", "c"]],
      [UNGROUPED_LABEL, ["d"]],
    ])
  })

  it("flattens to one group when grouping is off", () => {
    expect(shape(groupRuns(runs, "flat", "newest"))).toEqual([["All runs", ["d", "a", "b", "c"]]])
  })

  it("honours oldest-first", () => {
    expect(shape(groupRuns(runs, "flat", "oldest"))).toEqual([["All runs", ["c", "b", "a", "d"]]])
  })

  it("never emits an empty group", () => {
    expect(groupRuns([run("x", "running", 1)], "status", "newest").map((g) => g.label)).toEqual(["Active"])
    expect(groupRuns([], "status", "newest")).toEqual([])
    expect(groupRuns([], "flat", "newest")).toEqual([])
  })

  it("treats a blank project string as ungrouped rather than a group named ''", () => {
    expect(shape(groupRuns([run("y", "running", 1, "   ")], "project", "newest"))).toEqual([[UNGROUPED_LABEL, ["y"]]])
  })

  it("does not mutate the input array", () => {
    const input = [...runs]
    groupRuns(input, "flat", "oldest")
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c", "d"])
  })
})

describe("groupRuns — stopped is its own shelf", () => {
  const withStopped = [
    run("act", "running", 500),
    run("stp", "stopped", 400),
    run("fin", "done", 300),
    run("bad", "failed", 200),
  ]

  it("separates stopped from Done so it does not read as finished", () => {
    // A stopped run is over but its work did not land — someone has to pick it
    // up. Listed beside completed runs it looks like a clean finish.
    expect(shape(groupRuns(withStopped, "status", "newest"))).toEqual([
      ["Active", ["act"]],
      ["Stopped", ["stp"]],
      ["Done", ["fin", "bad"]],
    ])
  })

  it("does not put stopped back in Active — nothing is running", () => {
    const groups = groupRuns(withStopped, "status", "newest")
    expect(groups.find((g) => g.label === "Active")!.runs.map((r) => r.id)).not.toContain("stp")
  })

  it("omits the Stopped group entirely when nothing is stopped", () => {
    expect(shape(groupRuns([run("a", "running", 1), run("b", "done", 2)], "status", "newest")))
      .toEqual([["Active", ["a"]], ["Done", ["b"]]])
  })
})
