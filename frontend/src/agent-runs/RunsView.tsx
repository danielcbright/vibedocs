import { Activity } from "lucide-react"
import type { RunMeta } from "@shared/agent-run-types"
import { useRunRecords } from "./hooks/use-run-records"
import { RunHeader } from "./RunHeader"
import { Timeline } from "./Timeline"
import { useRunsConfig } from "./hooks/use-runs-config"

interface RunsViewProps {
  runs: RunMeta[]
  loading: boolean
  activeRunId: string | null
  /** Re-fetch rail + open-run meta after a lifecycle write. */
  onRunChanged: () => void
  /** Bumped by the WS nudge for the open run, to pull the record tail. */
  recordsNonce?: number
}

/**
 * Agent Runs: lane rail on the left, transcript on the right.
 *
 * At zero runs the empty state is the normal condition of a freshly enabled
 * server, not an error — so it explains how a client records one. It never
 * renders the ingest token.
 */
export function RunsView({ runs, loading, activeRunId, onRunChanged, recordsNonce }: RunsViewProps) {
  const selectedId = activeRunId ?? runs[0]?.id ?? null
  const { events, meta, error, fetchTail, refreshMeta } = useRunRecords(selectedId)

  const { rules } = useRunsConfig(true)

  const handleChanged = () => {
    void refreshMeta()
    onRunChanged()
  }

  // A run-records nudge for the open run pulls only the tail.
  if (recordsNonce !== undefined) void recordsNonce
  useTailOnNonce(fetchTail, recordsNonce)

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading runs…</div>

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
            streaming events to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /api/runs/:id/events</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {meta && <RunHeader meta={meta} onChanged={handleChanged} />}
      {error && (
        <div className="border-b bg-red-500/10 px-4 py-2 text-[12px] text-red-500">{error}</div>
      )}
      <div className="min-h-0 flex-1">
        <Timeline events={events} workdir={meta?.workdir} rules={rules} runId={selectedId ?? undefined} />
      </div>
    </div>
  )
}

import { useEffect, useRef } from "react"

/** Pull the record tail whenever the nonce changes (a WS nudge arrived). */
function useTailOnNonce(fetchTail: () => void, nonce?: number) {
  const seen = useRef(nonce)
  useEffect(() => {
    if (nonce === undefined || nonce === seen.current) return
    seen.current = nonce
    fetchTail()
  }, [nonce, fetchTail])
}
