import { useState } from "react"
import { ChevronDown, CircleCheck, CircleX, Clock, OctagonAlert } from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { RunMeta, RunStatus } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"
import { isTerminalStatus } from "./lib/run-status"

const OUTCOMES: { status: RunStatus; label: string; icon: typeof CircleCheck }[] = [
  { status: "done", label: "Merged", icon: CircleCheck },
  { status: "waiting", label: "Waiting", icon: Clock },
  { status: "failed", label: "Failed", icon: CircleX },
]

/**
 * Run controls.
 *
 * Two kinds of action, given two weights rather than four equal buttons.
 * Recording an outcome (merged / waiting / failed) is something you do once, at
 * the end, so it collapses into one menu. Stop is the only thing you reach for
 * while a run is moving, so it stays a button — and only while there is
 * something to stop.
 *
 * Marking an outcome is a pure state write: PATCH {status}, no process
 * involved. Stop is not: VibeDocs does not own the agent process and may not be
 * on the same machine, so it records intent for the owning client to poll and
 * ack. There is no exec endpoint.
 */
export function RunActions({ meta, onChanged }: { meta: RunMeta; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(label: string, run: () => Promise<Response>) {
    setBusy(label)
    setError(null)
    try {
      const res = await run()
      if (!res.ok) throw new Error(res.status === 403 ? "not allowed from this origin" : `failed (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed")
    } finally {
      // Reconcile with what the server actually has, either way — a failed
      // write must not leave a status on screen that was never saved.
      onChanged()
      setBusy(null)
    }
  }

  const setStatus = (status: RunStatus) =>
    send(status, () => fetch(`/api/runs/${encodeURIComponent(meta.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }))

  const requestStop = () =>
    send("stop", () => fetch(`/api/runs/${encodeURIComponent(meta.id)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "stop" }),
    }))

  // One definition, imported. This used to be an inline copy of the terminal
  // list, so moving a status between categories changed grouping while leaving
  // this button's idea of "finished" behind.
  const isTerminal = isTerminalStatus(meta.status)

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-[11px] text-red-500">{error}</span>}

      {!isTerminal && (
        <button
          type="button"
          onClick={requestStop}
          disabled={busy !== null || meta.stopRequested === true}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
            "text-muted-foreground hover:bg-accent hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <OctagonAlert className="h-3 w-3" />
          {meta.stopRequested ? "Stop requested" : "Stop"}
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {busy && busy !== "stop" ? "Saving…" : "Set outcome"}
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {OUTCOMES.map(({ status, label, icon: Icon }) => (
            <DropdownMenuItem
              key={status}
              disabled={meta.status === status}
              onSelect={() => void setStatus(status)}
              className="gap-2 text-xs"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
