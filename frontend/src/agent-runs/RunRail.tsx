import { useState } from "react"
import type { RunMeta } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"
import { RunStatusIcon } from "./components/icons"
import { RunLinks } from "./RunLinks"
import { groupRuns, type RunGrouping, type RunSort } from "./lib/group-runs"

const GROUPINGS: { value: RunGrouping; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
  { value: "flat", label: "None" },
]

/**
 * Lane rail. Renders inside the existing sidebar shell — it replaces the file
 * tree rather than introducing a second chrome.
 *
 * Grouping is the operator's choice: by status while work is in flight, by
 * project when watching several checkouts at once, or off for a plain
 * newest-first list.
 */
export function RunRail({ runs, activeRunId, onSelect }: {
  runs: RunMeta[]
  activeRunId: string | null
  onSelect: (id: string) => void
}) {
  const [grouping, setGrouping] = useState<RunGrouping>("status")
  const [sort, setSort] = useState<RunSort>("newest")
  const groups = groupRuns(runs, grouping, sort)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-sidebar-border px-2 py-1.5 text-[10.5px]">
        <span className="text-muted-foreground">Group</span>
        <div className="flex items-center overflow-hidden rounded border border-sidebar-border">
          {GROUPINGS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={grouping === g.value}
              onClick={() => setGrouping(g.value)}
              className={cn(
                "px-1.5 py-0.5 transition-colors",
                grouping === g.value
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
          className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          title="Toggle sort order"
        >
          {sort === "newest" ? "Newest" : "Oldest"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-muted-foreground">No runs yet.</div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="py-1.5">
            <div className="px-3 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label} · {group.runs.length}
            </div>
            {group.runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelect(run.id)}
                className={cn(
                  "tap-row flex w-full flex-col gap-0.5 border-l-2 px-3 py-1.5 text-left transition-colors",
                  run.id === activeRunId
                    ? "border-l-primary bg-sidebar-accent"
                    : "border-l-transparent hover:bg-sidebar-accent/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <RunStatusIcon status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{run.title}</span>
                </div>
                {/* Project only matters as a row detail when it is not already
                    the group heading. */}
                {run.project && grouping !== "project" && (
                  <div className="truncate pl-[22px] text-[10.5px] text-muted-foreground">{run.project}</div>
                )}
                {run.links.length > 0 && (
                  <div className="pl-[22px]">
                    <RunLinks links={run.links} size="sm" />
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
