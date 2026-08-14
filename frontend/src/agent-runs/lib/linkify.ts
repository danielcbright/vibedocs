import type { LinkKind } from "@shared/agent-run-types"
import type { AgentRunsClientConfig, LinkifyRule } from "@shared/agent-runs-config-types"
import { isSafeUrlTemplate } from "@shared/agent-runs-config-types"

export interface Segment {
  text: string
  href?: string
  kind?: LinkKind
  title?: string
}

export interface CompiledRule {
  regex: RegExp
  url: string
  kind: LinkKind
}

/** Bare URLs are always linked, ahead of any configured rule. */
const BARE_URL = /\bhttps?:\/\/[^\s<>()"']+/g

/**
 * Compile config rules once. linkify runs per rendered row, so recompiling a
 * regex per row would be the hot path.
 */
export function compileRules(config: AgentRunsClientConfig): CompiledRule[] {
  const out: CompiledRule[] = []
  for (const rule of config.linkify) {
    if (!isSafeUrlTemplate(rule.url)) continue
    try {
      const flags = new Set(["g", ...(rule.flags ?? "")])
      out.push({ regex: new RegExp(rule.pattern, [...flags].join("")), url: rule.url, kind: rule.kind })
    } catch {
      continue // an uncompilable pattern is dropped, never thrown at render time
    }
  }
  return out
}

function substitute(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d)/g, (_, d) => match[Number(d)] ?? "")
}

/**
 * Split text into plain and linked segments.
 *
 * Overlaps resolve earliest-and-longest-wins, which is the non-obvious part:
 * without it a rule matching a substring of another rule's match produces
 * nested or duplicated links.
 */
export function linkify(text: string, rules: readonly CompiledRule[]): Segment[] {
  if (!text) return []
  interface Hit { start: number; end: number; href: string; kind: LinkKind }
  const hits: Hit[] = []

  const url = new RegExp(BARE_URL)
  let m: RegExpExecArray | null
  while ((m = url.exec(text))) {
    hits.push({ start: m.index, end: m.index + m[0].length, href: m[0], kind: "other" })
  }

  for (const rule of rules) {
    const re = new RegExp(rule.regex.source, rule.regex.flags)
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex += 1; continue } // never loop on an empty match
      const href = substitute(rule.url, m)
      if (isSafeUrlTemplate(href)) {
        hits.push({ start: m.index, end: m.index + m[0].length, href, kind: rule.kind })
      }
    }
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Hit[] = []
  for (const h of hits) if (!kept.length || h.start >= kept[kept.length - 1].end) kept.push(h)

  const out: Segment[] = []
  let i = 0
  for (const h of kept) {
    if (h.start > i) out.push({ text: text.slice(i, h.start) })
    out.push({ text: text.slice(h.start, h.end), href: h.href, kind: h.kind })
    i = h.end
  }
  if (i < text.length) out.push({ text: text.slice(i) })
  return out
}

export type { LinkifyRule }
