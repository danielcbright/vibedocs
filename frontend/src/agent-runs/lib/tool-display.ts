import type { AgentEvent, ToolInfo } from "@shared/agent-run-types"

export function fmtTime(ms?: number): string {
  if (!ms) return ""
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
}

export function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/**
 * Paths display relative to the run's workdir. Absolute paths are unreadable in
 * a narrow gutter and every one of them starts with the same 60 characters.
 */
export function shortenPath(p: string, workdir?: string): string {
  if (!p) return ""
  const root = workdir?.replace(/\/$/, "")
  if (root && p.startsWith(root + "/")) return p.slice(root.length + 1)
  return p.replace(/^\/(?:Users|home)\/[^/]+\//, "~/")
}

export function toolSummary(tool: ToolInfo): string {
  if (tool.status === "running") return "running"
  if (tool.linesAdded != null || tool.linesRemoved != null) {
    return `+${tool.linesAdded ?? 0} / -${tool.linesRemoved ?? 0}`
  }
  if (tool.exitCode != null) return `exit ${tool.exitCode}`
  return tool.status === "error" ? "error" : "done"
}

/** Language guess for highlighting a tool's output. */
export function toolLang(tool: ToolInfo): string {
  const p = String(tool.args?.path ?? tool.args?.file_path ?? "")
  if (/\.tsx?$/.test(p)) return "typescript"
  if (/\.jsx?$/.test(p)) return "javascript"
  if (/\.go$/.test(p)) return "go"
  if (/\.py$/.test(p)) return "python"
  if (/\.sh$/.test(p)) return "bash"
  if (/\.ya?ml$/.test(p)) return "yaml"
  if (/\.json$/.test(p)) return "json"
  if (/\.md$/.test(p)) return "markdown"
  if (tool.name === "shell") return "bash"
  return "text"
}

/** What the row's copy button yields. */
export function toolCopyText(event: AgentEvent): string {
  const tool = event.tool
  if (!tool) return event.text ?? ""
  const parts = [`$ ${tool.label}`]
  if (tool.exitCode != null) parts.push(`exit ${tool.exitCode}`)
  if (tool.output) parts.push(tool.output)
  return parts.join("\n")
}

/** True when this event's body is worth expanding. */
export function isExpandable(event: AgentEvent): boolean {
  return event.kind === "tool" || event.kind === "thinking" || event.kind === "user"
}

/** One-line title for any event kind. */
export function eventTitle(event: AgentEvent, workdir?: string): string {
  switch (event.kind) {
    case "tool": {
      const t = event.tool!
      const isPath = t.args?.path != null || t.args?.file_path != null
      return isPath ? shortenPath(t.label, workdir) : t.label
    }
    case "thinking": {
      const words = (event.text ?? "").split(/\s+/).filter(Boolean).length
      return `Reasoning · ${words} word${words === 1 ? "" : "s"}`
    }
    case "user":
      return "Brief dispatched"
    case "init":
      return `Session ${String(event.meta?.sessionId ?? "").slice(0, 8)} · ${String(event.meta?.model ?? "")}`
    case "result":
      return event.meta?.isError ? "Turn failed" : "Turn complete"
    case "assistant":
      return event.text ?? ""
    default:
      return `${event.meta?.vendorType ?? "event"}/${event.meta?.vendorSubtype ?? ""}`
  }
}
