import type { RunMeta } from "@shared/agent-run-types"
import { RunStatusIcon } from "./components/icons"
import { RunLinks } from "./RunLinks"
import { RunActions } from "./RunActions"
import { fmtTime } from "./lib/tool-display"

/**
 * Identity strip above the transcript: what this run is, where it links, and
 * what you can do to it. Kept to two rows so it reads as a header rather than a
 * control panel.
 */
export function RunHeader({ meta, onChanged }: { meta: RunMeta; onChanged: () => void }) {
  return (
    <header className="shrink-0 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <RunStatusIcon status={meta.status} className="h-4 w-4" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{meta.title}</h2>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {meta.eventCount} events · {fmtTime(meta.updatedAt)}
        </span>
      </div>
      {meta.description && (
        <p className="mt-1 truncate text-[12px] text-muted-foreground">{meta.description}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <RunLinks links={meta.links} />
        <div className="ml-auto">
          <RunActions meta={meta} onChanged={onChanged} />
        </div>
      </div>
    </header>
  )
}
