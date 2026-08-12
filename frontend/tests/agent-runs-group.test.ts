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
