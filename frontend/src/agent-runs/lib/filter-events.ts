import type { AgentEvent } from "@shared/agent-run-types"

export type QuickFilter = "all" | "tools" | "failures" | "narrative"

export const QUICK_FILTERS: readonly QuickFilter[] = ["all", "tools", "failures", "narrative"]

export interface FilterCriteria {
  query: string
  quick: QuickFilter
}

function matchesQuick(event: AgentEvent, quick: QuickFilter): boolean {
  switch (quick) {
    case "tools":
      return event.kind === "tool"
    case "failures":
      return event.kind === "tool"
        ? event.tool?.status === "error"
        : event.kind === "result" && event.meta?.isError === true
    case "narrative":
      return event.kind === "assistant" || event.kind === "user" || event.kind === "result"
    default:
      return true
  }
}

/** Haystack for the text filter: command text and output, plus event text. */
function haystack(event: AgentEvent): string {
  if (event.tool) return `${event.tool.label}\n${event.tool.output ?? ""}`
  return event.text ?? ""
}

/**
 * Pure filter over the timeline. Never renumbers or reorders — a filtered view
 * is a subset of the same events, so seq keys stay stable.
 */
export function filterEvents(events: readonly AgentEvent[], { query, quick }: FilterCriteria): AgentEvent[] {
  const q = query.trim().toLowerCase()
  return events.filter((e) => matchesQuick(e, quick) && (q === "" || haystack(e).toLowerCase().includes(q)))
}
