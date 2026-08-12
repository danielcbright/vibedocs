import { describe, it, expect } from "vitest"
import { followReducer, INITIAL_FOLLOW_STATE, AT_BOTTOM_THRESHOLD } from "@/agent-runs/hooks/use-follow-mode"

const reduce = (state = INITIAL_FOLLOW_STATE, ...actions: Parameters<typeof followReducer>[1][]) =>
  actions.reduce((s, a) => followReducer(s, a), state)

describe("followReducer", () => {
  it("opens pinned with no jump button", () => {
    expect(INITIAL_FOLLOW_STATE).toEqual({ pinned: true, showJumpButton: false })
  })

  it("stays pinned when events arrive while pinned", () => {
    expect(reduce(INITIAL_FOLLOW_STATE, { type: "events-appended" })).toEqual({ pinned: true, showJumpButton: false })
  })

  it("releases the pin and shows the button when scrolled up past the threshold", () => {
    expect(reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: 400 }))
      .toEqual({ pinned: false, showJumpButton: true })
  })

  it("re-pins when scrolled back to within the threshold", () => {
    const released = reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: 400 })
    expect(reduce(released, { type: "scrolled", distanceFromBottom: 5 }))
      .toEqual({ pinned: true, showJumpButton: false })
  })

  it("treats exactly-at-threshold as at the bottom, so rounding cannot flap the pin", () => {
    expect(reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: AT_BOTTOM_THRESHOLD }).pinned).toBe(true)
    expect(reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: AT_BOTTOM_THRESHOLD + 1 }).pinned).toBe(false)
  })

  it("does NOT re-pin when events arrive after the reader scrolled up", () => {
    // The whole point: reading history must not be interrupted by new events.
    const released = reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: 900 })
    const after = reduce(released, { type: "events-appended" }, { type: "events-appended" })
    expect(after).toEqual({ pinned: false, showJumpButton: true })
  })

  it("re-pins and hides the button when jump is clicked", () => {
    const released = reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: 900 })
    expect(reduce(released, { type: "jump-clicked" })).toEqual({ pinned: true, showJumpButton: false })
  })

  it("resets to pinned when the run changes", () => {
    const released = reduce(INITIAL_FOLLOW_STATE, { type: "scrolled", distanceFromBottom: 900 })
    expect(reduce(released, { type: "run-changed" })).toEqual(INITIAL_FOLLOW_STATE)
  })
})
