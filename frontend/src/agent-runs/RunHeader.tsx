import type { RunMeta } from "@shared/agent-run-types"
import { RunStatusIcon } from "./components/icons"
import { RunLinks } from "./RunLinks"
import { RunActions } from "./RunActions"
import { fmtRelative } from "./lib/tool-display"

/**
 * Identity strip above the transcript.
 *
 * Two rows, not three: title and controls on one line, and a single quiet meta
 * line carrying everything you might want but rarely read — project, counts,
 * recency, links. The earlier shape put description, links and four equal
 * buttons on their own rows, which made the header compete with the transcript
 * it is supposed to introduce.
 */
export function RunHeader({ meta, onChanged }: { meta: RunMeta; onChanged: () => void }) {
  const facts = [
    meta.project,
    `${meta.eventCount} event${meta.eventCount === 1 ? "" : "s"}`,
    fmtRelative(meta.updatedAt),
    meta.agent,
  ].filter(Boolean)

  return (
    <header className="shrink-0 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <RunStatusIcon status={meta.status} className="h-4 w-4" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={meta.title}>
          {meta.title}
        </h2>
        <RunActions meta={meta} onChanged={onChanged} />
      </div>

      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{facts.join(" · ")}</span>
        {meta.links.length > 0 && (
          <div className="ml-auto shrink-0">
            <RunLinks links={meta.links} />
          </div>
        )}
      </div>

      {meta.description && (
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground" title={meta.description}>
          {meta.description}
        </p>
      )}
    </header>
  )
}
