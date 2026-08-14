import { describe, it, expect } from "vitest"
import { filterEvents } from "@/agent-runs/lib/filter-events"
import type { AgentEvent } from "@shared/agent-run-types"

const events: AgentEvent[] = [
  { seq: 1, ts: 1, kind: "user", text: "Add a health endpoint" },
  { seq: 2, ts: 2, kind: "assistant", text: "I will edit the router" },
  { seq: 3, ts: 3, kind: "thinking", text: "considering options" },
  { seq: 4, ts: 4, kind: "tool", tool: { name: "shell", callId: "a", label: "npm test", args: {}, status: "success", output: "5 passing" } },
  { seq: 5, ts: 5, kind: "tool", tool: { name: "shell", callId: "b", label: "npm run build", args: {}, status: "error", exitCode: 1, output: "TS2304" } },
  { seq: 6, ts: 6, kind: "result", text: "done", meta: { isError: false } },
  { seq: 7, ts: 7, kind: "result", text: "boom", meta: { isError: true } },
]
const seqs = (q: Parameters<typeof filterEvents>[1]) => filterEvents(events, q).map((e) => e.seq)

describe("filterEvents", () => {
  it("returns everything by default", () => {
    expect(seqs({ query: "", quick: "all" })).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("tools keeps only tool events", () => {
    expect(seqs({ query: "", quick: "tools" })).toEqual([4, 5])
  })

  it("failures keeps tool errors AND failed results", () => {
    expect(seqs({ query: "", quick: "failures" })).toEqual([5, 7])
  })

  it("narrative keeps assistant, user and result", () => {
    expect(seqs({ query: "", quick: "narrative" })).toEqual([1, 2, 6, 7])
  })

  it("matches tool command text and tool output", () => {
    expect(seqs({ query: "npm run", quick: "all" })).toEqual([5])
    expect(seqs({ query: "5 passing", quick: "all" })).toEqual([4])
  })

  it("matches event text and is case-insensitive", () => {
    expect(seqs({ query: "HEALTH", quick: "all" })).toEqual([1])
  })

  it("combines the quick filter with the query", () => {
    expect(seqs({ query: "npm", quick: "failures" })).toEqual([5])
  })

  it("ignores surrounding whitespace in the query", () => {
    expect(seqs({ query: "  health  ", quick: "all" })).toEqual([1])
  })

  it("returns nothing when nothing matches, without throwing", () => {
    expect(seqs({ query: "zzz-nope", quick: "all" })).toEqual([])
  })

  it("preserves order and seq — a filtered view is a subset, not a renumbering", () => {
    const out = filterEvents(events, { query: "", quick: "tools" })
    expect(out.map((e) => e.seq)).toEqual([4, 5])
    expect(out[0]).toBe(events[3])
  })
})
