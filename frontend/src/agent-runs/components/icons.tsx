import {
  Activity, Brain, CircleCheck, CircleStop, CircleX, Clock, Dot, FilePen,
  FileText, Flag, FolderSearch, Loader2, MessageSquare, OctagonAlert, Play,
  Search, Sparkles, Terminal, Wrench, type LucideIcon,
} from "lucide-react"
import type { EventKind, RunStatus, ToolStatus } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"

// lucide only — no emoji anywhere in this feature.

const STATUS_ICONS: Record<RunStatus, LucideIcon> = {
  running: Loader2, idle: Activity, blocked: OctagonAlert, waiting: Clock,
  done: CircleCheck, failed: CircleX, stopped: CircleStop,
}

const STATUS_CLASS: Record<RunStatus, string> = {
  running: "text-blue-500 animate-spin", idle: "text-muted-foreground",
  blocked: "text-amber-500", waiting: "text-amber-500",
  done: "text-emerald-500", failed: "text-red-500", stopped: "text-muted-foreground",
}

export function RunStatusIcon({ status, className }: { status: RunStatus; className?: string }) {
  const Icon = STATUS_ICONS[status] ?? Activity
  return <Icon aria-label={status} className={cn("h-3.5 w-3.5 shrink-0", STATUS_CLASS[status], className)} />
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
