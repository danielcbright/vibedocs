import {
  Activity, Brain, CircleCheck, CircleStop, CircleX, Clock, Dot, FilePen,
  FileText, Flag, FolderSearch, Hourglass, Loader2, MessageSquare, OctagonAlert,
  Play, Search, Sparkles, Terminal, Wrench, type LucideIcon,
} from "lucide-react"
import type { EventKind, RunStatus, ToolStatus } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"
import { isStopPending } from "../lib/run-status"

// lucide only — no emoji anywhere in this feature.

const STATUS_ICONS: Record<RunStatus, LucideIcon> = {
  running: Loader2, idle: Activity, blocked: OctagonAlert, waiting: Clock,
  done: CircleCheck, failed: CircleX, stopped: CircleStop,
}

const STATUS_CLASS: Record<RunStatus, string> = {
  running: "text-blue-500 animate-spin", idle: "text-muted-foreground",
  blocked: "text-amber-500", waiting: "text-amber-500",
  done: "text-emerald-500", failed: "text-red-500",
  // Deliberately not muted. A stopped run is a loose end, and grey put it in the
  // same visual family as inactive/finished so it read as complete.
  stopped: "text-orange-500",
}

/**
 * A run's status glyph.
 *
 * `stopRequested` renders as a modifier on the underlying status rather than a
 * status of its own: the stop is queued but the agent has not acknowledged it, so
 * the run genuinely is still whatever it was. An hourglass says "asked, waiting"
 * — which is also the honest picture when no client is polling to honour it.
 */
export function RunStatusIcon(
  { status, stopRequested, className }:
  { status: RunStatus; stopRequested?: boolean; className?: string },
) {
  const pending = isStopPending({ status, stopRequested })
  const Icon = pending ? Hourglass : (STATUS_ICONS[status] ?? Activity)
  const tone = pending ? "text-orange-500 animate-pulse" : STATUS_CLASS[status]
  return (
    <Icon
      aria-label={pending ? `${status}, stop requested` : status}
      className={cn("h-3.5 w-3.5 shrink-0", tone, className)}
    />
  )
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  shell: Terminal, read: FileText, edit: FilePen, write: FilePen,
  grep: Search, glob: FolderSearch, ls: FolderSearch,
}

export function ToolIcon({ tool, className }: { tool: string; className?: string }) {
  const Icon = TOOL_ICONS[tool] ?? Wrench
  return <Icon className={cn("h-3 w-3", className)} />
}

const KIND_ICONS: Record<EventKind, LucideIcon> = {
  init: Play, user: MessageSquare, thinking: Brain, assistant: Sparkles,
  tool: Wrench, result: Flag, other: Dot,
}

export function KindIcon({ kind, className }: { kind: EventKind; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? Dot
  return <Icon className={cn("h-3 w-3", className)} />
}

const TOOL_STATUS_CLASS: Record<ToolStatus, string> = {
  running: "text-blue-500 animate-spin", success: "text-emerald-500", error: "text-red-500",
}

export function ToolStatusIcon({ status }: { status: ToolStatus }) {
  const Icon = status === "running" ? Loader2 : status === "error" ? CircleX : CircleCheck
  return <Icon aria-label={status} className={cn("h-3.5 w-3.5 shrink-0", TOOL_STATUS_CLASS[status])} />
}
