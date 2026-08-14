import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Follow mode, anchored at the BOTTOM.
 *
 * Opening a run lands on the newest event and stays pinned as events arrive.
 * Scrolling up releases the pin and reveals "jump to latest"; clicking it
 * re-pins. Getting release/re-pin right matters more than the animation — a
 * view that snatches the scroll back while you are reading is worse than no
 * follow mode at all.
 *
 * The decision is a pure reducer so it can be tested without a scroll container.
 */
export interface FollowState {
  pinned: boolean
  showJumpButton: boolean
}

export type FollowAction =
  | { type: "scrolled"; distanceFromBottom: number }
  | { type: "events-appended" }
  | { type: "jump-clicked" }
  | { type: "run-changed" }

/** Within this many pixels of the bottom counts as "at the bottom". */
export const AT_BOTTOM_THRESHOLD = 48

export const INITIAL_FOLLOW_STATE: FollowState = { pinned: true, showJumpButton: false }

export function followReducer(
  state: FollowState,
  action: FollowAction,
  opts: { threshold?: number } = {},
): FollowState {
  const threshold = opts.threshold ?? AT_BOTTOM_THRESHOLD
  switch (action.type) {
    case "scrolled": {
      // Exactly at the threshold counts as at-bottom, so a rounding wobble
      // does not flap the pin.
      const atBottom = action.distanceFromBottom <= threshold
      return { pinned: atBottom, showJumpButton: !atBottom }
    }
    case "events-appended":
      // Never re-pin on new events: if the reader scrolled up, they stay put.
      return state
    case "jump-clicked":
      return { pinned: true, showJumpButton: false }
    case "run-changed":
      return INITIAL_FOLLOW_STATE
    default:
      return state
  }
}

export function useFollowMode(runId: string | null, eventCount: number) {
  const [state, setState] = useState<FollowState>(INITIAL_FOLLOW_STATE)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const dispatch = useCallback((action: FollowAction) => {
    setState((prev) => followReducer(prev, action))
  }, [])

  useEffect(() => { dispatch({ type: "run-changed" }) }, [runId, dispatch])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  // Follow: only move the viewport while pinned.
  useEffect(() => {
    if (state.pinned) scrollToBottom()
  }, [eventCount, state.pinned, scrollToBottom])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    dispatch({ type: "scrolled", distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight })
  }, [dispatch])

  const jumpToLatest = useCallback(() => {
    dispatch({ type: "jump-clicked" })
    scrollToBottom("smooth")
  }, [dispatch, scrollToBottom])

  return { ...state, scrollRef, onScroll, jumpToLatest }
}
