import { describe, it, expect } from "vitest"
import { compileRules, linkify } from "@/agent-runs/lib/linkify"

const config = {
  editorScheme: "editor://file",
  linkify: [
    { pattern: "\\b([A-Z]+-\\d+)\\b", url: "https://tracker.example.com/browse/$1", kind: "issue" as const },
    { pattern: "\\bPR #(\\d+)\\b", url: "https://git.example.com/org/repo/pull/$1", kind: "pr" as const },
  ],
}
const rules = compileRules(config)
const hrefs = (t: string) => linkify(t, rules).filter((s) => s.href).map((s) => s.href)

describe("linkify", () => {
  it("links configured patterns with capture-group substitution", () => {
    expect(hrefs("see PROJ-42 now")).toEqual(["https://tracker.example.com/browse/PROJ-42"])
    expect(hrefs("landed in PR #7")).toEqual(["https://git.example.com/org/repo/pull/7"])
  })

  it("links bare URLs even with no rules configured", () => {
    expect(linkify("go to https://example.com/x now", []).filter((s) => s.href).map((s) => s.href))
      .toEqual(["https://example.com/x"])
  })

  it("carries the rule kind onto the segment for icon selection", () => {
    expect(linkify("PROJ-42", rules).find((s) => s.href)?.kind).toBe("issue")
  })

  it("returns a single plain segment when nothing matches", () => {
    expect(linkify("nothing here", rules)).toEqual([{ text: "nothing here" }])
  })

  it("resolves overlaps earliest-and-longest-wins, never nesting links", () => {
    const overlapping = compileRules({
      editorScheme: null,
      linkify: [
        { pattern: "abc", url: "https://x.example.com/short", kind: "other" as const },
        { pattern: "abcdef", url: "https://x.example.com/long", kind: "other" as const },
      ],
    })
    expect(hrefsWith("abcdef", overlapping)).toEqual(["https://x.example.com/long"])
  })

  it("never emits an href for a dangerous scheme, even if config supplied one", () => {
    const evil = compileRules({ editorScheme: null, linkify: [{ pattern: "x", url: "javascript:alert(1)", kind: "other" as const }] })
    expect(evil).toHaveLength(0)
    expect(linkify("x", evil)).toEqual([{ text: "x" }])
  })

  it("drops an uncompilable pattern at compile time rather than throwing at render", () => {
    expect(compileRules({ editorScheme: null, linkify: [{ pattern: "(", url: "https://x.example.com", kind: "other" as const }] })).toEqual([])
  })

  it("does not hang on a pattern that can match empty", () => {
    const empty = compileRules({ editorScheme: null, linkify: [{ pattern: "a*", url: "https://x.example.com", kind: "other" as const }] })
    expect(() => linkify("bbb", empty)).not.toThrow()
  })

  it("preserves the surrounding text exactly", () => {
    expect(linkify("see PROJ-42 now", rules).map((s) => s.text).join("")).toBe("see PROJ-42 now")
  })
})

function hrefsWith(t: string, r: ReturnType<typeof compileRules>) {
  return linkify(t, r).filter((s) => s.href).map((s) => s.href)
}
