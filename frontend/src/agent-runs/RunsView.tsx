import { Activity } from "lucide-react"
import type { RunMeta } from "@shared/agent-run-types"

interface RunsViewProps {
  runs: RunMeta[]
  loading: boolean
  activeRunId: string | null
}

/**
 * Agent Runs detail pane.
 *
 * At zero runs this is the normal state of a freshly enabled server, not an
 * error — so it explains how a client records one rather than reading as a
 * failure. It never renders the ingest token.
 */
export function RunsView({ runs, loading, activeRunId }: RunsViewProps) {
  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading runs…</div>
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <Activity className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
          <h2 className="mb-2 text-lg font-semibold">No agent runs yet</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Agent Runs shows headless coding-agent runs as they work — a lane rail here, a
            streaming transcript alongside it.
          </p>
          <p className="text-sm text-muted-foreground">
            A client records one by posting to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /api/runs</code>, then
            streaming its events to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /api/runs/:id/events</code>.
          </p>
        </div>
      </div>
    )
  }

  const active = runs.find((r) => r.id === activeRunId) ?? runs[0]
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold">{active.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {active.eventCount} events · {active.status}
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        The transcript timeline lands in the next change.
      </p>
    </div>
  )
}
