import { describe, it, expect } from "vitest"
import { railLinks } from "@/agent-runs/RunLinks"
import type { RunLink } from "@shared/agent-run-types"

const issue: RunLink = { label: "PROJ-1", url: "https://t.example.com/1", kind: "issue" }
const pr: RunLink = { label: "PR #2", url: "https://g.example.com/pull/2", kind: "pr" }
const ci: RunLink = { label: "CI 3", url: "https://g.example.com/runs/3", kind: "ci" }
const other: RunLink = { label: "docs", url: "https://e.example.com", kind: "other" }

const kinds = (l: RunLink[]) => railLinks(l).map((x) => x.kind)

describe("railLinks", () => {
  it("shows the issue key and the PR when both exist — a done run must not hide its PR", () => {
    expect(kinds([issue, pr, ci])).toEqual(["issue", "pr"])
  })

  it("keeps issue before PR regardless of input order", () => {
    expect(kinds([ci, pr, issue])).toEqual(["issue", "pr"])
  })

  it("shows just the issue key while there is no PR yet", () => {
    expect(kinds([issue, ci])).toEqual(["issue"])
  })

  it("shows the PR alone when there is no issue", () => {
    expect(kinds([pr, ci])).toEqual(["pr"])
  })

  it("never shows CI in the rail when an issue or PR is present", () => {
    expect(kinds([issue, pr, ci])).not.toContain("ci")
  })

  it("falls back to the first link rather than showing nothing", () => {
    expect(kinds([ci, other])).toEqual(["ci"])
  })

  it("returns nothing for a run with no links", () => {
    expect(railLinks([])).toEqual([])
  })
})
