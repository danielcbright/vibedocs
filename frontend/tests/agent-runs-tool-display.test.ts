import { describe, it, expect } from "vitest"
import { fmtDuration, shortenPath, toolSummary, eventTitle, toolCopyText } from "@/agent-runs/lib/tool-display"
import type { AgentEvent, ToolInfo } from "@shared/agent-run-types"

const tool = (over: Partial<ToolInfo> = {}): ToolInfo =>
  ({ name: "shell", callId: "c1", label: "npm test", args: {}, status: "success", ...over })

describe("fmtDuration", () => {
  it("scales units and refuses nonsense", () => {
    expect(fmtDuration(250)).toBe("250ms")
    expect(fmtDuration(1500)).toBe("1.5s")
    expect(fmtDuration(125_000)).toBe("2m 5s")
    // The bake-off produced "29774740m" from a missing timestamp; guard it.
    expect(fmtDuration(undefined)).toBe("")
    expect(fmtDuration(-1)).toBe("")
    expect(fmtDuration(NaN)).toBe("")
  })
})

describe("shortenPath", () => {
  it("strips the workdir prefix", () => {
    expect(shortenPath("/home/dev/app/src/router.ts", "/home/dev/app")).toBe("src/router.ts")
    expect(shortenPath("/home/dev/app/src/router.ts", "/home/dev/app/")).toBe("src/router.ts")
  })
  it("falls back to a home-relative form when the workdir does not match", () => {
    expect(shortenPath("/home/someone/other/x.ts", "/home/dev/app")).toBe("~/other/x.ts")
  })
  it("leaves unrelated paths alone", () => {
    expect(shortenPath("relative/x.ts")).toBe("relative/x.ts")
  })
})

describe("toolSummary", () => {
  it("prefers line counts, then exit code, then status", () => {
    expect(toolSummary(tool({ linesAdded: 9, linesRemoved: 0 }))).toBe("+9 / -0")
    expect(toolSummary(tool({ exitCode: 1, status: "error" }))).toBe("exit 1")
    expect(toolSummary(tool({ status: "running" }))).toBe("running")
    expect(toolSummary(tool())).toBe("done")
  })
})

describe("eventTitle", () => {
  const ev = (over: Partial<AgentEvent>): AgentEvent => ({ seq: 1, ts: 1, kind: "other", ...over })

  it("shortens a tool path against the workdir but leaves a command alone", () => {
    expect(eventTitle(ev({ kind: "tool", tool: tool({ label: "/home/dev/app/src/a.ts", args: { path: "/home/dev/app/src/a.ts" } }) }), "/home/dev/app")).toBe("src/a.ts")
    expect(eventTitle(ev({ kind: "tool", tool: tool({ label: "npm test" }) }), "/home/dev/app")).toBe("npm test")
  })

  it("summarises reasoning by word count, pluralising correctly", () => {
    expect(eventTitle(ev({ kind: "thinking", text: "one two three" }))).toBe("Reasoning · 3 words")
    expect(eventTitle(ev({ kind: "thinking", text: "one" }))).toBe("Reasoning · 1 word")
  })

  it("distinguishes a failed turn from a complete one", () => {
    expect(eventTitle(ev({ kind: "result", meta: { isError: true } }))).toBe("Turn failed")
    expect(eventTitle(ev({ kind: "result", meta: { isError: false } }))).toBe("Turn complete")
  })
})

describe("toolCopyText", () => {
  it("yields command, exit code and output", () => {
    const text = toolCopyText({ seq: 1, ts: 1, kind: "tool", tool: tool({ exitCode: 1, output: "boom", status: "error" }) })
    expect(text).toBe("$ npm test\nexit 1\nboom")
  })
  it("falls back to the event text for non-tool events", () => {
    expect(toolCopyText({ seq: 1, ts: 1, kind: "assistant", text: "hello" })).toBe("hello")
  })
})
