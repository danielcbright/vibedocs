import { useMemo, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { AgentEvent } from "@shared/agent-run-types"
import { TimelineRow } from "./TimelineRow"
import { FilterBar } from "./FilterBar"
import { filterEvents, type QuickFilter } from "./lib/filter-events"
import { followReducer, INITIAL_FOLLOW_STATE, type FollowState } from "./hooks/use-follow-mode"
import type { CompiledRule } from "./lib/linkify"

/**
 * The transcript: a vertical spine with a monospace timestamp gutter and one
 * node per event, filtered above and virtualized within.
 *
 * Follow mode is anchored at the BOTTOM and Virtuoso owns the scroll anchor:
 * `followOutput` moves the viewport only while pinned, and `atBottomStateChange`
 * drives the pin. Running a custom scroll handler alongside it would make two
 * things fight over the same anchor.
 */
export function Timeline({ events, workdir, rules, runId }: { events: AgentEvent[]; workdir?: string; rules?: readonly CompiledRule[]; runId?: string }) {
  const [query, setQuery] = useState("")
  const [quick, setQuick] = useState<QuickFilter>("all")
  const [follow, setFollow] = useState<FollowState>(INITIAL_FOLLOW_STATE)
  const virtuoso = useRef<VirtuosoHandle>(null)

  const shown = useMemo(() => filterEvents(events, { query, quick }), [events, query, quick])

  // Filtering is a reading action, so it should not drag the viewport to the
  // end; only follow the tail on the unfiltered view.
  const isFiltered = query.trim() !== "" || quick !== "all"
  const pinned = follow.pinned && !isFiltered

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        query={query} onQueryChange={setQuery}
        quick={quick} onQuickChange={setQuick}
        shown={shown.length} total={events.length}
      />

      <div className="relative min-h-0 flex-1">
        {shown.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground">
            {events.length === 0 ? "No events recorded yet." : "No events match this filter."}
          </div>
        ) : (
          <>
            {/* The spine, aligned with the icon column. */}
            <div className="pointer-events-none absolute bottom-2 left-[109px] top-2 z-0 w-px bg-border" />
            <Virtuoso
              data={shown}
              followOutput={pinned ? "auto" : false}
              initialTopMostItemIndex={Math.max(0, shown.length - 1)}
              atBottomThreshold={48}
              atBottomStateChange={(atBottom) =>
                setFollow((s) => followReducer(s, { type: "scrolled", distanceFromBottom: atBottom ? 0 : 1000 }))
              }
              computeItemKey={(_, event) => event.seq}
              ref={virtuoso}
              className="h-full px-4"
              itemContent={(_, event) => <TimelineRow event={event} workdir={workdir} rules={rules} runId={runId} />}
            />
            {follow.showJumpButton && !isFiltered && (
              <button
                type="button"
                onClick={() => {
                  // followOutput only reacts to NEW data, so re-pinning alone
                  // would leave the viewport where it was — scroll explicitly.
                  setFollow((s) => followReducer(s, { type: "jump-clicked" }))
                  virtuoso.current?.scrollToIndex({ index: shown.length - 1, behavior: "smooth", align: "end" })
                }}
                className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-md backdrop-blur transition-colors hover:bg-accent"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                Jump to latest
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
