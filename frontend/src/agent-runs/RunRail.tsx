import type { RunMeta } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"
import { RunStatusIcon } from "./components/icons"
import { RUN_TERMINAL_STATUSES } from "./lib/run-status"
import { RunLinks } from "./RunLinks"

/**
 * Lane rail: active runs above, finished below.
 *
 * A row's links are real anchors, so the issue key is clickable here and not
 * only in the detail header — clicking the row selects the run, clicking the
 * key opens the configured URL.
 */
export function RunRail({ runs, activeRunId, onSelect }: {
  runs: RunMeta[]
  activeRunId: string | null
  onSelect: (id: string) => void
}) {
  const active = runs.filter((r) => !RUN_TERMINAL_STATUSES.includes(r.status))
  const done = runs.filter((r) => RUN_TERMINAL_STATUSES.includes(r.status))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Group label="Active" runs={active} activeRunId={activeRunId} onSelect={onSelect} />
      <Group label="Done" runs={done} activeRunId={activeRunId} onSelect={onSelect} />
    </div>
  )
}

function Group({ label, runs, activeRunId, onSelect }: {
  label: string
  runs: RunMeta[]
  activeRunId: string | null
  onSelect: (id: string) => void
}) {
  if (runs.length === 0) return null
  return (
    <div className="py-2">
      <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label} · {runs.length}
      </div>
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => onSelect(run.id)}
          className={cn(
            "tap-row flex w-full flex-col gap-0.5 border-l-2 px-3 py-2 text-left transition-colors",
            run.id === activeRunId
              ? "border-l-primary bg-accent/60"
              : "border-l-transparent hover:bg-accent/30",
          )}
        >
          <div className="flex items-center gap-2">
            <RunStatusIcon status={run.status} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{run.title}</span>
          </div>
          {run.description && (
            <div className="truncate pl-[22px] text-[11.5px] text-muted-foreground">{run.description}</div>
          )}
          {run.links.length > 0 && (
            <div className="pl-[22px]">
              <RunLinks links={run.links} size="sm" />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
