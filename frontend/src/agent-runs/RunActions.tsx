import { useState } from "react"
import { CircleCheck, CircleX, Clock, OctagonAlert } from "lucide-react"
import type { RunMeta, RunStatus } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"

/**
 * Lifecycle controls.
 *
 * Marking merged / failed / waiting are pure state writes — PATCH {status},
 * no process involved. Stop is different: VibeDocs does not own the agent
 * process and may not be on the same machine, so it records INTENT by queueing
 * a command the owning client polls for and acks. There is no exec endpoint.
 *
 * Both paths are same-origin writes; the browser never holds the ingest token.
 */
export function RunActions({ meta, onChanged }: { meta: RunMeta; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function patchStatus(status: RunStatus) {
    setBusy(status)
    setError(null)
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(meta.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      onChanged()
    } catch (err) {
      // Roll back to whatever the server actually has rather than leaving a
      // lying status on screen.
      setError(err instanceof Error ? err.message : "failed")
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function requestStop() {
    setBusy("stop")
    setError(null)
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(meta.id)}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "stop" }),
      })
      if (!res.ok) throw new Error(`stop ${res.status}`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed")
    } finally {
      setBusy(null)
    }
  }

  const isTerminal = ["done", "failed", "stopped"].includes(meta.status)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Action icon={CircleCheck} label="Merged" onClick={() => patchStatus("done")} busy={busy === "done"} disabled={meta.status === "done"} />
      <Action icon={Clock} label="Waiting" onClick={() => patchStatus("waiting")} busy={busy === "waiting"} disabled={meta.status === "waiting"} />
      <Action icon={CircleX} label="Failed" onClick={() => patchStatus("failed")} busy={busy === "failed"} disabled={meta.status === "failed"} />
      {!isTerminal && (
        <Action
          icon={OctagonAlert}
          label={meta.stopRequested ? "Stop requested" : "Stop"}
          onClick={requestStop}
          busy={busy === "stop"}
          disabled={meta.stopRequested === true}
          tone="danger"
        />
      )}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

function Action({ icon: Icon, label, onClick, busy, disabled, tone }: {
  icon: typeof CircleCheck
  label: string
  onClick: () => void
  busy: boolean
  disabled?: boolean
  tone?: "danger"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "text-red-500 hover:bg-red-500/10"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {busy ? "…" : label}
    </button>
  )
}
