/**
 * Agent Runs client configuration — shared with the frontend so it can linkify
 * transcript text without a second source of truth.
 *
 * Nothing vendor-specific ever enters this repo: the operator's issue-tracker
 * and repository URLs live in ~/.vibedocs/agent-runs.json on their machine.
 */
import type { LinkKind } from './agent-run-types.js'

export interface LinkifyRule {
  /** JS regex source. Capture groups substitute into `url` as $1, $2, … */
  pattern: string
  /** URL template, e.g. 'https://tracker.example.com/browse/$1'. */
  url: string
  /** Selects the lucide icon shown beside the link. */
  kind: LinkKind
  /** Extra regex flags. 'g' is always applied. */
  flags?: string
}

export interface AgentRunsClientConfig {
  linkify: LinkifyRule[]
  /** e.g. 'editor://file'. Null disables file-path links. */
  editorScheme: string | null
}

export const EMPTY_AGENT_RUNS_CLIENT_CONFIG: AgentRunsClientConfig = { linkify: [], editorScheme: null }

/** Bound on rule count — linkify runs per rendered row. */
export const MAX_LINKIFY_RULES = 64

const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:']

/** A config value must never be able to introduce an executable URL scheme. */
export function isSafeUrlTemplate(url: string): boolean {
  const lowered = url.trim().toLowerCase()
  return !DANGEROUS_SCHEMES.some((s) => lowered.startsWith(s))
}
